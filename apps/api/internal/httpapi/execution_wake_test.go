package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

func TestRequiredWakePrecedesAdmissionAndPreventsOrphanCommit(t *testing.T) {
	for _, fail := range []bool{false, true} {
		repo := &admissionRepository{result: judging.Submission{ID: "submission", State: "queued", ExecutionJobID: "must-not-publish-after-commit"}}
		publications := 0
		api := &Server{Store: repo, RequireExecutionWake: true, NotifyExecution: func(ctx context.Context, nonce string) error {
			if repo.calls != 0 {
				t.Fatal("wake followed admission")
			}
			if !uuid.MatchString(nonce) {
				t.Fatal("wake must be an opaque server nonce")
			}
			publications++
			if fail {
				return errors.New("queue unavailable")
			}
			return nil
		}}
		command := judging.Command{WorkspaceID: "bdccf853-633e-455f-906d-d585cb44fdd1", Kind: "submit", Source: "private source"}
		body, _ := json.Marshal(command)
		request := httptest.NewRequest("POST", "/v1/submissions", bytes.NewReader(body))
		request.Header.Set("Idempotency-Key", "retry-command")
		request.Header.Set("X-Quorem-Owner", "alice")
		response := httptest.NewRecorder()
		api.admit(response, request)
		if publications != 1 {
			t.Fatalf("duplicate/missing durable wake: %d", publications)
		}
		if fail && (response.Code != 503 || repo.calls != 0 || repo.committed) {
			t.Fatal("committed orphan despite failed durable wake")
		}
		if !fail && (response.Code != 202 || repo.calls != 1) {
			t.Fatalf("admission failed: %d %s", response.Code, response.Body.String())
		}
	}
}

type wakeInterviewRepository struct {
	*interviewRepositoryFake
	calls    int
	deadline time.Duration
}

func (r *wakeInterviewRepository) AdmitInterview(ctx context.Context, _, _, _ string, command interviews.ExecutionCommand) (judging.Submission, error) {
	r.calls++
	at, ok := ctx.Deadline()
	if !ok {
		return judging.Submission{}, errors.New("unbounded admission")
	}
	r.deadline = time.Until(at)
	return judging.Submission{ID: "submission", State: "queued", ExecutionJobID: "internal-job"}, nil
}
func TestInterviewRequiredWakeValidatesCommandAndBoundsAdmission(t *testing.T) {
	for _, kind := range []string{"run", "submit", "invalid"} {
		for _, fail := range []bool{false, true} {
			repo := &wakeInterviewRepository{interviewRepositoryFake: &interviewRepositoryFake{}}
			publications := 0
			api := &Server{Store: repo, RequireExecutionWake: true, NotifyExecution: func(context.Context, string) error {
				if repo.calls != 0 {
					t.Fatal("wake followed interview commit")
				}
				publications++
				if fail {
					return errors.New("queue unavailable")
				}
				return nil
			}}
			request := httptest.NewRequest("POST", "/v1/interviews/room/submissions", bytes.NewBufferString(`{"kind":"`+kind+`","level":1,"questionEpoch":"00000000-0000-4000-8000-000000000001","documentEpoch":"00000000-0000-4000-8000-000000000002","sourceHash":"`+strings.Repeat("a", 64)+`"}`))
			request.Header.Set("Idempotency-Key", "retry-command")
			request.Header.Set("X-Quorem-Owner", "alice")
			response := httptest.NewRecorder()
			api.admitInterview(response, request)
			switch {
			case kind == "invalid":
				if response.Code != 400 || publications != 0 || repo.calls != 0 {
					t.Fatal("invalid command woke runner")
				}
			case fail:
				if response.Code != 503 || publications != 1 || repo.calls != 0 {
					t.Fatal("failed wake committed interview job")
				}
			default:
				if response.Code != 202 || publications != 1 || repo.calls != 1 || repo.deadline <= 0 || repo.deadline > 10*time.Second {
					t.Fatalf("bad admission status=%d deadline=%s", response.Code, repo.deadline)
				}
			}
		}
	}
}

func TestRequiredWakeFailureLeavesNoDatabaseJob(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateWorkspace(ctx, "alice", problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "class Solution: pass"})
	request := httptest.NewRequest("POST", "/v1/submissions", bytes.NewReader(body))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Idempotency-Key", "durable-wake-fails")
	request.Header.Set("X-Dev-User", "alice")
	response := httptest.NewRecorder()
	(&Server{Store: store, Local: true, RequireExecutionWake: true, NotifyExecution: func(context.Context, string) error { return errors.New("durable queue down") }}).Handler().ServeHTTP(response, request)
	if response.Code != 503 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var jobs, submissions int
	if err = store.Pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM execution_jobs),(SELECT count(*) FROM submissions)").Scan(&jobs, &submissions); err != nil {
		t.Fatal(err)
	}
	if jobs != 0 || submissions != 0 {
		t.Fatalf("orphan admission committed: jobs=%d submissions=%d", jobs, submissions)
	}
}
