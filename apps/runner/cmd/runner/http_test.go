package main

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type fakeDrainer struct {
	calls    int
	complete bool
	err      error
}

func (d *fakeDrainer) Drain(ctx context.Context, _ execution.ExecutionEngine, slots int) (worker.DrainState, bool, error) {
	d.calls++
	if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 240*time.Second {
		return worker.DrainState{}, false, errors.New("unbounded context")
	}
	return worker.DrainState{Queued: 2, Running: 1}, d.complete, d.err
}
func TestHTTPDrainAuthenticationAndQueueAckBoundary(t *testing.T) {
	token := strings.Repeat("x", 32)
	for _, tc := range []struct {
		name, method, path, bearer string
		complete                   bool
		err                        error
		status, calls              int
	}{
		{name: "health is idle", method: "GET", path: "/health", status: 200},
		{name: "missing token", method: "POST", path: "/internal/drain", status: 401},
		{name: "wrong token", method: "POST", path: "/internal/drain", bearer: "Bearer wrong", status: 401},
		{name: "remaining jobs", method: "POST", path: "/internal/drain", bearer: "Bearer " + token, status: 202, calls: 1},
		{name: "globally idle", method: "POST", path: "/internal/drain", bearer: "Bearer " + token, complete: true, status: 200, calls: 1},
		{name: "dependency failure", method: "POST", path: "/internal/drain", bearer: "Bearer " + token, err: errors.New("private database detail"), status: 503, calls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			drainer := &fakeDrainer{complete: tc.complete, err: tc.err}
			request := httptest.NewRequest(tc.method, tc.path, nil)
			request.Header.Set("Authorization", tc.bearer)
			response := httptest.NewRecorder()
			drainHandler(drainer, nil, 2, token).ServeHTTP(response, request)
			if response.Code != tc.status || drainer.calls != tc.calls {
				t.Fatalf("status=%d calls=%d", response.Code, drainer.calls)
			}
			if strings.Contains(response.Body.String(), "private") {
				t.Fatal("dependency failure leaked")
			}
		})
	}
}
