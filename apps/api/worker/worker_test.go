package worker

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/delivery"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type memoryRepository struct {
	job        execution.Job
	jobs       []execution.Job
	expired    []string
	claims     int
	completion execution.Completion
	completed  int
	leaseAlive bool
}

func (r *memoryRepository) LoadExecution(context.Context, execution.Job) (Spec, error) {
	return Spec{}, nil
}
func (r *memoryRepository) ReconcileMatches(context.Context) error            { return nil }
func (r *memoryRepository) ExpiredAttempts(context.Context) ([]string, error) { return r.expired, nil }
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
func (r *memoryRepository) Complete(_ context.Context, j execution.Job, c execution.Completion) error {
	r.completed++
	r.completion = c
	return nil
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
func (e *fakeEngine) TeardownAttempt(context.Context, string) error { return e.err }
func TestExpiredSandboxMustBeReapedBeforeClaim(t *testing.T) {
	repo := &memoryRepository{expired: []string{"old-attempt"}}
	engine := &fakeEngine{err: errors.New("teardown failed")}
	New(repo).poll(context.Background(), engine)
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
			New(repo).poll(context.Background(), engine)
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
	if queue.acked.Load() != 1 || repo.claims != 2 || repo.completion.AttemptID != "fenced" {
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
	// The recovery poll is five seconds away; all jobs must finish from the coalesced wake.
	if engine.ran != 3 || repo.completed != 3 || queue.acked.Load() != delivery.MaxBatch {
		t.Fatalf("jobs=%d completed=%d acked=%d", engine.ran, repo.completed, queue.acked.Load())
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
