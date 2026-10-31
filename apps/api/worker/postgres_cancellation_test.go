package worker

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type countedCancellationStore struct {
	*postgres.Store
	count atomic.Int32
}

func (s *countedCancellationStore) ExecutionCancellations(ctx context.Context) (<-chan string, func(), error) {
	s.count.Add(1)
	return s.Store.ExecutionCancellations(ctx)
}

type blockingCancellationEngine struct {
	started chan string
	stopped chan string
	finish  chan struct{}
}

func (e *blockingCancellationEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	e.started <- j.SubmissionID
	select {
	case <-ctx.Done():
		e.stopped <- j.SubmissionID
		return execution.Completion{}, ctx.Err()
	case <-e.finish:
		return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, Verdict: execution.Accepted}, nil
	}
}

func TestPostgresCancellationCommitAndSharedWorkers(t *testing.T) {
	store := executionWakeStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	wakeAdmission(t, store, "alice")
	wakeAdmission(t, store, "bob")
	var alice, bob string
	if err := store.Pool.QueryRow(ctx, `SELECT id::text FROM submissions WHERE owner_id='alice'`).Scan(&alice); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool.QueryRow(ctx, `SELECT id::text FROM submissions WHERE owner_id='bob'`).Scan(&bob); err != nil {
		t.Fatal(err)
	}
	jobs := make([]execution.Job, 2)
	for i := range jobs {
		var err error
		jobs[i], err = store.ClaimAfterTeardown(ctx, false, "", "test-scope")
		if err != nil || jobs[i].JobID == "" {
			t.Fatal(jobs[i], err)
		}
	}
	wrapped := &countedCancellationStore{Store: store}
	service := New(wrapped)
	engine := &blockingCancellationEngine{started: make(chan string, 2), stopped: make(chan string, 2), finish: make(chan struct{})}
	done := make(chan error, 2)
	for _, job := range jobs {
		go func(j execution.Job) { done <- service.execute(ctx, engine, j, 0) }(job)
	}
	for range jobs {
		select {
		case <-engine.started:
		case <-ctx.Done():
			t.Fatal("jobs not started")
		}
	}
	if wrapped.count.Load() != 1 {
		t.Fatalf("expected one shared listener, got %d", wrapped.count.Load())
	}
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE submissions SET cancel_requested=true WHERE id=$1`, alice); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-engine.stopped:
		t.Fatalf("uncommitted cancellation stopped %s", id)
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Cancel(ctx, "alice", alice); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-engine.stopped:
		if id != alice {
			t.Fatalf("wrong job cancelled: %s", id)
		}
	case <-time.After(time.Second):
		t.Fatal("committed cancellation not delivered")
	}
	select {
	case id := <-engine.stopped:
		t.Fatalf("unrelated job stopped: %s", id)
	case <-time.After(100 * time.Millisecond):
	}
	close(engine.finish)
	for range jobs {
		if err = <-done; err != nil {
			t.Fatal(err)
		}
	}
	var state string
	if err = store.Pool.QueryRow(ctx, `SELECT state FROM submissions WHERE id=$1`, alice).Scan(&state); err != nil || state != "cancelled" {
		t.Fatal(state, err)
	}
	if err = store.Pool.QueryRow(ctx, `SELECT state FROM submissions WHERE id=$1`, bob).Scan(&state); err != nil || state != "completed" {
		t.Fatal(state, err)
	}
}

func TestPostgresCancellationAndAttemptFenceBeforeStart(t *testing.T) {
	for _, action := range []string{"cancel", "replace"} {
		t.Run(action, func(t *testing.T) {
			store := executionWakeStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			wakeAdmission(t, store, "alice")
			job, err := store.ClaimAfterTeardown(ctx, false, "", "test-scope")
			if err != nil || job.JobID == "" {
				t.Fatal(job, err)
			}
			if action == "cancel" {
				if _, err = store.Cancel(ctx, "alice", job.SubmissionID); err != nil {
					t.Fatal(err)
				}
			} else {
				tx, e := store.Pool.Begin(ctx)
				if e != nil {
					t.Fatal(e)
				}
				defer tx.Rollback(ctx)
				if _, err = tx.Exec(ctx, `SELECT set_config('quorem.sandbox_scope','test-scope',true)`); err != nil {
					t.Fatal(err)
				}
				if _, err = tx.Exec(ctx, `UPDATE execution_jobs SET attempt_id=$2 WHERE id=$1`, job.JobID, postgres.ID()); err != nil {
					t.Fatal(err)
				}
				if err = tx.Commit(ctx); err != nil {
					t.Fatal(err)
				}
			}
			engine := &fakeEngine{}
			if err = New(store).execute(ctx, engine, job, 0); err != nil {
				t.Fatal(err)
			}
			if engine.ran != 0 {
				t.Fatal("executed cancelled or stale attempt")
			}
		})
	}
}
