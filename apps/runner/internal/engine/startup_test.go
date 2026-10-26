package engine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSandboxStartupDoesNotConsumeContestantBudget(t *testing.T) {
	for _, tc := range []struct {
		name, status       string
		startup, execution time.Duration
		parentDeadline     bool
	}{
		{"slow startup", "executed", 300 * time.Millisecond, 0, false},
		{"slow contestant", "time_limit", 0, 300 * time.Millisecond, false},
		{"cancel during startup", "", 300 * time.Millisecond, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := fakeEngine(t, func(_ []byte, writer io.Writer) {
				time.Sleep(tc.startup)
				dockerFrame(writer, 1, []byte{0})
				time.Sleep(tc.execution)
				dockerFrame(writer, 1, []byte(`{"status":"executed","actual":[]}`))
			})
			limits := execution.DefaultLimits()
			limits.WallTimeMS = 100
			ctx := context.Background()
			if tc.parentDeadline {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			frame, err := (&Docker{client: client}).runCase(ctx, execution.Job{AttemptID: "startup-test", Limits: limits}, 0, worker.Spec{}, worker.Case{Args: []json.RawMessage{}})
			if tc.parentDeadline {
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatal("parent cancellation became a contestant failure", frame, err)
				}
			} else if err != nil || frame.Status != tc.status {
				t.Fatal(frame, err)
			}
		})
	}
}
