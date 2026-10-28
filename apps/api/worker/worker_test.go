package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/delivery"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type memoryRepository struct {
	job           execution.Job
	jobs          []execution.Job
	expired       []string
	reconciles    int
	claims        int
	completion    execution.Completion
	completed     int
	leaseAlive    bool
	completionErr error
}

func (r *memoryRepository) LoadExecution(context.Context, execution.Job) (Spec, error) {
	return Spec{}, nil
}
func (r *memoryRepository) ReconcileBackground(context.Context) error { r.reconciles++; return nil }
func (r *memoryRepository) NextExpiredAttempt(context.Context, bool, string) (string, error) {
	if len(r.expired) > 0 {
		return r.expired[0], nil
	}
	return "", nil
}
func (r *memoryRepository) ClaimAfterTeardown(ctx context.Context, _ bool, _, _ string) (execution.Job, error) {
	return r.Claim(ctx)
}
func (r *memoryRepository) Claim(context.Context) (execution.Job, error) {
	r.claims++
	if len(r.jobs) > 0 {
		job := r.jobs[0]
		r.jobs = r.jobs[1:]
		return job, nil
	}
	job := r.job
	r.job = execution.Job{}
	return job, nil
}
func (r *memoryRepository) Lease(context.Context, execution.Job, bool) (bool, error) {
	return r.leaseAlive, nil
}
func (r *memoryRepository) ExecutionCancellations(ctx context.Context) (<-chan string, func(), error) {
	return testCancellationNotifications(ctx)
}
func (r *memoryRepository) ExecutionNotifications(parent context.Context) (<-chan struct{}, func(), error) {
	ctx, cancel := context.WithCancel(parent)
	events := make(chan struct{})
	go func() { <-ctx.Done(); close(events) }()
	return events, cancel, nil
}
func (r *memoryRepository) NextExecutionDeadline(context.Context) (time.Duration, bool, error) {
	return 0, false, nil
}

func testCancellationNotifications(parent context.Context) (<-chan string, func(), error) {
	ctx, cancel := context.WithCancel(parent)
	events := make(chan string)
	go func() { <-ctx.Done(); close(events) }()
	return events, cancel, nil
}
func (r *memoryRepository) Complete(_ context.Context, j execution.Job, c execution.Completion) error {
	r.completed++
	r.completion = c
	return r.completionErr
}

type fakeEngine struct {
	err       error
	ran       int
	wait      bool
	onExecute func()
}

func (e *fakeEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	e.ran++
	if e.onExecute != nil {
		e.onExecute()
	}
	if e.wait {
		<-ctx.Done()
	}
	return execution.Completion{AttemptID: j.AttemptID}, e.err
}
func (e *fakeEngine) TeardownAttempt(context.Context, string, string) error { return e.err }
func TestExpiredSandboxMustBeReapedBeforeClaim(t *testing.T) {
	repo := &memoryRepository{expired: []string{"old-attempt"}}
	engine := &fakeEngine{err: errors.New("teardown failed")}
	New(repo).claim(context.Background(), engine)
	if repo.claims != 0 || engine.ran != 0 {
		t.Fatal("claimed while sandbox teardown unconfirmed")
	}
}
func TestExecutionCompletionAndTeardownFence(t *testing.T) {
	for _, test := range []struct {
		name      string
		err       error
		completed int
		failure   bool
	}{{"success", nil, 1, false}, {"engine failure", errors.New("private engine detail"), 1, true}, {"teardown unconfirmed", ErrTeardown, 0, false}} {
		t.Run(test.name, func(t *testing.T) {
			repo := &memoryRepository{job: execution.Job{JobID: "authoritative", AttemptID: "fenced"}, leaseAlive: true}
			engine := &fakeEngine{err: test.err}
			New(repo).claim(context.Background(), engine)
			if repo.completed != test.completed || engine.ran != 1 {
				t.Fatalf("completion count %d, executions %d", repo.completed, engine.ran)
			}
			if test.failure && repo.completion.EngineFailure != "Execution engine unavailable" {
				t.Fatal("raw engine failure leaked")
			}
		})
	}
}

type wakeQueue struct {
	acked    atomic.Int32
	received atomic.Int32
	batch    int
}

func (q *wakeQueue) Publish(context.Context, delivery.Notification) error { return nil }
func (q *wakeQueue) Receive(ctx context.Context, _ int) ([]delivery.Message, error) {
	if q.received.Add(1) == 1 {
		count := q.batch
		if count == 0 {
			count = 1
		}
		messages := make([]delivery.Message, count)
		for i := range messages {
			messages[i] = delivery.Message{Notification: delivery.Notification{JobID: "untrusted-message-job"}, Receipt: "receipt"}
		}
		return messages, nil
	}
	<-ctx.Done()
	return nil, ctx.Err()
}
func (q *wakeQueue) Ack(context.Context, string) error                  { q.acked.Add(1); return nil }
func (q *wakeQueue) Retry(context.Context, string, time.Duration) error { return nil }
func TestNotificationsWakeDatabaseClaim(t *testing.T) {
	queue := &wakeQueue{}
	repo := &memoryRepository{job: execution.Job{JobID: "authoritative", AttemptID: "fenced"}, leaseAlive: true}
	engine := &fakeEngine{}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := New(repo, WithQueue(queue)).Run(ctx, engine); err != nil {
		t.Fatal(err)
	}
	if queue.acked.Load() != 1 || (repo.claims < 2 || repo.claims > 3) || repo.completion.AttemptID != "fenced" {
		t.Fatalf("notification bypassed database ownership: %+v", repo)
	}
}

func TestCoalescedNotificationsDrainDurableJobs(t *testing.T) {
	queue := &wakeQueue{batch: delivery.MaxBatch}
	repo := &memoryRepository{jobs: []execution.Job{{JobID: "first", AttemptID: "first-attempt"}, {JobID: "second", AttemptID: "second-attempt"}, {JobID: "third", AttemptID: "third-attempt"}}, leaseAlive: true}
	engine := &fakeEngine{}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := New(repo, WithQueue(queue)).Run(ctx, engine); err != nil {
		t.Fatal(err)
	}
	// All jobs must finish from the coalesced wake.
	if engine.ran != 3 || repo.completed != 3 || queue.acked.Load() != delivery.MaxBatch {
		t.Fatalf("jobs=%d completed=%d acked=%d", engine.ran, repo.completed, queue.acked.Load())
	}
	if repo.reconciles < 1 || repo.reconciles > 2 {
		t.Fatalf("reconciled %d times for coalesced wakes", repo.reconciles)
	}
	if repo.claims > 5 {
		t.Fatalf("empty queue busy loop: %d claims", repo.claims)
	}
}
func TestDrainingStopsBeforeNextClaimWhenCancelled(t *testing.T) {
	queue := &wakeQueue{}
	repo := &memoryRepository{jobs: []execution.Job{{JobID: "first", AttemptID: "first-attempt"}, {JobID: "second", AttemptID: "second-attempt"}}, leaseAlive: true}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := &fakeEngine{onExecute: cancel}
	if err := New(repo, WithQueue(queue)).Run(ctx, engine); err != nil {
		t.Fatal(err)
	}
	if engine.ran != 1 || repo.claims != 1 {
		t.Fatalf("claim after cancellation: executions=%d claims=%d", engine.ran, repo.claims)
	}
}

type timingEngine struct{ err error }

func (e timingEngine) Execute(_ context.Context, j execution.Job) (execution.Completion, error) {
	time.Sleep(2 * time.Millisecond)
	return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID,
		PublicCaseResults:   []execution.PublicCaseResult{{Actual: json.RawMessage(`"private-actual"`), Expected: json.RawMessage(`"private-expected"`), Stdout: "private-output", Stderr: "private-diagnostic"}},
		SubmitSampleResults: []execution.PublicCaseResult{{Actual: json.RawMessage(`"private-sample"`)}},
	}, e.err
}

func TestExecutionTimingIsAvailableWithoutPrivatePayloads(t *testing.T) {
	for _, tc := range []struct {
		name, outcome            string
		engineErr, completionErr error
	}{
		{"completed", "completed", nil, nil},
		{"engine failure", "engine_unavailable", errors.New("private-engine-error"), nil},
		{"teardown failure", "teardown_unconfirmed", ErrTeardown, nil},
		{"completion failure", "completion_unavailable", nil, errors.New("private-completion-error")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&output)
			defer log.SetOutput(previous)
			repo := &memoryRepository{leaseAlive: true, completionErr: tc.completionErr}
			job := execution.Job{Language: "private-untrusted-language", JobID: "private-job", SubmissionID: "private-submission", AttemptID: "private-attempt", SourceRef: "private-source", SuiteRef: "private-suite", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision}
			New(repo).execute(context.Background(), timingEngine{tc.engineErr}, job, 3*time.Millisecond)
			line := output.String()
			for _, field := range []string{"Judge execution timing language=python", "claim_ms=3", "execute_ms=", "complete_ms=", "total_ms=", "cases=1", "samples=1", "outcome=" + tc.outcome} {
				if !strings.Contains(line, field) {
					t.Fatalf("missing timing field %q in %q", field, line)
				}
			}
			if strings.Contains(line, "private-") {
				t.Fatalf("private execution data leaked: %q", line)
			}
		})
	}
}
