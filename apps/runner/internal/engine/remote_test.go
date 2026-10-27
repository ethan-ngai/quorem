package engine

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func testCaseFrame(channel byte, data []byte) []byte {
	b := make([]byte, 8+len(data))
	b[0] = channel
	binary.BigEndian.PutUint32(b[4:8], uint32(len(data)))
	copy(b[8:], data)
	return b
}

func TestRemoteSandboxStreamsAndConfirmsTeardown(t *testing.T) {
	token := "test-control-token-at-least-32-characters"
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Path != "/internal/case/attempt-123" {
			t.Errorf("invalid request")
		}
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != "current input" || r.Header.Get("X-Case-Language") != "python" || r.Header.Get("X-Case-Token") != "case-token-123456" {
			t.Errorf("invalid case request")
		}
		w.Write(testCaseFrame(1, []byte{0, 'o', 'k'}))
		w.Write(testCaseFrame(2, []byte("err")))
		w.Write(testCaseFrame(3, []byte{0, 0, 0, 0}))
		w.Write(testCaseFrame(4, nil))
	}))
	defer server.Close()
	sandbox, err := NewRemoteSandbox(server.URL, token)
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code, err := sandbox.run(context.Background(), "attempt-123", "case-token-123456", "python", execution.DefaultLimits(), []byte("current input"), &stdout, &stderr, nil)
	if err != nil || code != 0 || stdout.String() != "\x00ok" || stderr.String() != "err" {
		t.Fatalf("run: %d %q %q %v", code, stdout.String(), stderr.String(), err)
	}
	if err := sandbox.remove(context.Background(), "attempt-123", ""); err != nil || calls != 2 {
		t.Fatalf("teardown: %v, calls=%d", err, calls)
	}
}

func TestRemoteSandboxRejectsUnsafeEndpointsAndUnconfirmedTeardown(t *testing.T) {
	if _, err := NewRemoteSandbox("http://example.com", "12345678901234567890123456789012"); err == nil {
		t.Fatal("accepted insecure remote endpoint")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer server.Close()
	sandbox, err := NewRemoteSandbox(server.URL, "12345678901234567890123456789012")
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(sandbox.remove(context.Background(), "attempt", ""), worker.ErrTeardown) {
		t.Fatal("accepted uncertain teardown")
	}
	for _, data := range [][]byte{nil, testCaseFrame(1, []byte("x")), testCaseFrame(3, []byte{0}), append(testCaseFrame(3, []byte{0, 0, 0, 0}), 1)} {
		if _, err := copyCaseFrames(bytes.NewReader(data), io.Discard, io.Discard, nil); err == nil {
			t.Fatalf("accepted malformed frame %v", data)
		}
	}
}

func TestCancelledRemoteRequestCanConfirmCleanup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	sandbox, err := NewRemoteSandbox(server.URL, "12345678901234567890123456789012")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = sandbox.run(ctx, "attempt", "case-token-123456", "python", execution.DefaultLimits(), nil, io.Discard, io.Discard, nil)
	if err == nil || errors.Is(err, worker.ErrTeardown) {
		t.Fatalf("request error must not claim cleanup failed: %v", err)
	}
	if err := sandbox.remove(context.Background(), "attempt", "case-token-123456"); err != nil {
		t.Fatalf("cleanup not confirmed: %v", err)
	}
}

func TestRemoteSandboxRetriesOnlyPreDispatchConflict(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusConflict)
			return
		}
		w.Write(testCaseFrame(3, []byte{0, 0, 0, 0}))
		w.Write(testCaseFrame(4, nil))
	}))
	defer server.Close()
	sandbox, err := NewRemoteSandbox(server.URL, "12345678901234567890123456789012")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sandbox.run(context.Background(), "attempt", "case-token-123456", "python", execution.DefaultLimits(), []byte("input"), io.Discard, io.Discard, nil); err != nil || calls != 2 {
		t.Fatalf("retry failed: calls=%d err=%v", calls, err)
	}
}

func TestRemoteCleanupDoesNotConsumeContestantTime(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(testCaseFrame(1, []byte("\x00{\"status\":\"executed\",\"actual\":1}")))
		w.Write(testCaseFrame(3, []byte{0, 0, 0, 0}))
		w.(http.Flusher).Flush()
		time.Sleep(150 * time.Millisecond)
		w.Write(testCaseFrame(4, nil))
	}))
	defer server.Close()
	remote, err := NewRemoteSandbox(server.URL, "12345678901234567890123456789012")
	if err != nil {
		t.Fatal(err)
	}
	limits := execution.DefaultLimits()
	limits.WallTimeMS = 50
	f, err := (&Docker{Remote: remote}).runCase(context.Background(), execution.Job{AttemptID: "attempt", Limits: limits}, 0, worker.Spec{}, worker.Case{})
	if err != nil || f.Status != "executed" {
		t.Fatalf("cleanup consumed contestant time: %+v %v", f, err)
	}
}

func TestRemoteSandboxCheckConnection(t *testing.T) {
	token := "test-control-token-at-least-32-characters"
	status := http.StatusNoContent
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/internal/case/ready" || r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("invalid readiness request")
		}
		w.WriteHeader(status)
	}))
	defer server.Close()
	sandbox, err := NewRemoteSandbox(server.URL, token)
	if err != nil {
		t.Fatal(err)
	}
	if err := sandbox.CheckConnection(context.Background()); err != nil {
		t.Fatal(err)
	}
	status = http.StatusUnauthorized
	if err := sandbox.CheckConnection(context.Background()); err == nil {
		t.Fatal("accepted failed readiness")
	}
}
