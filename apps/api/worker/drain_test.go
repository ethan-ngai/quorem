package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

type drainRepository struct {
	mu                                                 sync.Mutex
	jobs                                               []execution.Job
	running, completed, claims, states, listens, stops int
	wake                                               chan struct{}
	err                                                error
}

func (r *drainRepository) LoadExecution(context.Context, execution.Job) (Spec, error) {
	return Spec{}, nil
}
func (r *drainRepository) ReconcileMatches(context.Context) error            { return nil }
func (r *drainRepository) ExpiredAttempts(context.Context) ([]string, error) { return nil, nil }
func (r *drainRepository) Claim(context.Context) (execution.Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.claims++
	if len(r.jobs) == 0 {
		return execution.Job{}, nil
	}
	j := r.jobs[0]
	r.jobs = r.jobs[1:]
	r.running++
	return j, nil
}
func (r *drainRepository) Lease(context.Context, execution.Job, bool) (bool, error) { return true, nil }
func (r *drainRepository) Complete(context.Context, execution.Job, execution.Completion) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.running--
	r.completed++
	return nil
}
func (r *drainRepository) ExecutionQueueState(context.Context) (int, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.states++
	return len(r.jobs), r.running, r.err
}
func (r *drainRepository) ExecutionNotifications(context.Context) (<-chan struct{}, func(), error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listens++
	if r.wake == nil {
		r.wake = make(chan struct{}, 1)
	}
	return r.wake, func() { r.mu.Lock(); defer r.mu.Unlock(); r.stops++ }, nil
}
func (r *drainRepository) add(j execution.Job) {
	r.mu.Lock()
	r.jobs = append(r.jobs, j)
	wake := r.wake
	r.mu.Unlock()
	wake <- struct{}{}
}

type drainEngine struct{ active, max atomic.Int32 }

func (e *drainEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	active := e.active.Add(1)
	defer e.active.Add(-1)
	for {
		old := e.max.Load()
		if active <= old || e.max.CompareAndSwap(old, active) {
			break
		}
	}
	select {
	case <-time.After(20 * time.Millisecond):
	case <-ctx.Done():
	}
	return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID}, nil
}

func TestDrainWaitsForPreAdmissionCommitThenRunsConcurrentJobs(t *testing.T) {
	repo := &drainRepository{}
	engine := &drainEngine{}
	service := New(repo)
	if repo.states != 0 || repo.listens != 0 || repo.claims != 0 {
		t.Fatal("idle service touched database")
	}
	go func() {
		time.Sleep(40 * time.Millisecond)
		// The durable wake can precede both admission commits.
		repo.add(execution.Job{JobID: "one", AttemptID: "one"})
		repo.add(execution.Job{JobID: "two", AttemptID: "two"})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	started := time.Now()
	state, complete, err := service.drain(ctx, engine, 2, 120*time.Millisecond)
	if err != nil || !complete || state.Queued != 0 || state.Running != 0 {
		t.Fatalf("state=%+v complete=%t err=%v", state, complete, err)
	}
	if time.Since(started) < 120*time.Millisecond || engine.max.Load() != 2 || repo.completed != 2 {
		t.Fatalf("grace/concurrency lost max=%d completed=%d", engine.max.Load(), repo.completed)
	}
	if repo.stops != 1 {
		t.Fatal("listener leaked beyond drain")
	}
	calls := repo.states + repo.claims
	time.Sleep(30 * time.Millisecond)
	if calls != repo.states+repo.claims {
		t.Fatal("idle drain kept polling")
	}
}

func TestDrainTransientFailureAndDeadlineNeverAcknowledgeCompletion(t *testing.T) {
	for _, failure := range []error{nil, errors.New("database unavailable")} {
		repo := &drainRepository{err: failure}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		_, complete, err := New(repo).drain(ctx, &drainEngine{}, 1, time.Second)
		cancel()
		if complete || (failure != nil) != (err != nil) {
			t.Fatalf("false queue acknowledgment: complete=%t err=%v", complete, err)
		}
		if repo.stops != 1 {
			t.Fatal("listener not released")
		}
	}
}

func TestOverlappingPreAdmissionWakeExtendsGraceWithoutIdlePolling(t *testing.T) {
	repo := &drainRepository{}
	service := New(repo)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	timer := time.AfterFunc(70*time.Millisecond, service.RefreshAdmissionGrace)
	defer timer.Stop()
	started := time.Now()
	_, complete, err := service.drain(ctx, &drainEngine{}, 1, 100*time.Millisecond)
	if err != nil || !complete || time.Since(started) < 170*time.Millisecond {
		t.Fatalf("overlapping admission lost grace: complete=%t elapsed=%s err=%v", complete, time.Since(started), err)
	}
}
