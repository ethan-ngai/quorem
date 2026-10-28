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
func (r *drainRepository) ReconcileBackground(context.Context) error { return nil }
func (r *drainRepository) NextExpiredAttempt(context.Context, bool, string) (string, error) {
	return "", nil
}
func (r *drainRepository) ClaimAfterTeardown(ctx context.Context, _ bool, _, _ string) (execution.Job, error) {
	return r.Claim(ctx)
}
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
func (r *drainRepository) ExecutionCancellations(ctx context.Context) (<-chan string, func(), error) {
	return testCancellationNotifications(ctx)
}
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
func (r *drainRepository) NextExecutionDeadline(context.Context) (time.Duration, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return 0, len(r.jobs) > 0, r.err
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

func (r *drainRepository) ConfirmExecutionQueueEmpty(context.Context) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.jobs) == 0 && r.running == 0, r.err
}

type finalConfirmationRepository struct {
	*drainRepository
	confirms             int
	confirmationError    error
	insertOnConfirmation bool
}

func (r *finalConfirmationRepository) ConfirmExecutionQueueEmpty(ctx context.Context) (bool, error) {
	r.confirms++
	if r.confirmationError != nil {
		return false, r.confirmationError
	}
	if r.insertOnConfirmation {
		r.insertOnConfirmation = false
		r.mu.Lock()
		r.jobs = append(r.jobs, execution.Job{JobID: "committed-during-confirmation", AttemptID: "fenced"})
		r.mu.Unlock()
		return false, nil
	}
	return r.drainRepository.ConfirmExecutionQueueEmpty(ctx)
}
func TestDrainFinalConfirmationFailureCannotAcknowledgeWake(t *testing.T) {
	repo := &finalConfirmationRepository{drainRepository: &drainRepository{}, confirmationError: errors.New("admission commit unresolved")}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, complete, err := New(repo).drain(ctx, &drainEngine{}, 1, time.Millisecond)
	if err == nil || complete || repo.confirms != 1 {
		t.Fatalf("false ACK complete=%t confirmations=%d err=%v", complete, repo.confirms, err)
	}
}
func TestDrainPicksUpAdmissionDiscoveredDuringFinalConfirmation(t *testing.T) {
	repo := &finalConfirmationRepository{drainRepository: &drainRepository{}, insertOnConfirmation: true}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, complete, err := New(repo).drain(ctx, &drainEngine{}, 1, time.Millisecond)
	if err != nil || !complete || repo.confirms != 2 || repo.completed != 1 {
		t.Fatalf("missed committing admission complete=%t confirmations=%d completed=%d err=%v", complete, repo.confirms, repo.completed, err)
	}
}

func TestHealthyIdleRunnerAndDrainDoNotRescan(t *testing.T) {
	for _, mode := range []string{"continuous", "http"} {
		t.Run(mode, func(t *testing.T) {
			repo := &drainRepository{}
			service := New(repo)
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})
			go func() {
				defer close(done)
				if mode == "http" {
					_, _, _ = service.drain(ctx, &drainEngine{}, 1, 2*time.Second)
				} else {
					_ = service.Run(ctx, &drainEngine{})
				}
			}()
			defer func() { cancel(); <-done; service.Close() }()
			time.Sleep(80 * time.Millisecond)
			repo.mu.Lock()
			beforeClaims, beforeStates := repo.claims, repo.states
			repo.mu.Unlock()
			if beforeClaims == 0 {
				t.Fatal("initial scan did not run")
			}
			time.Sleep(350 * time.Millisecond)
			repo.mu.Lock()
			afterClaims, afterStates := repo.claims, repo.states
			repo.mu.Unlock()
			if beforeClaims != afterClaims || beforeStates != afterStates {
				t.Fatalf("idle rescanned: claims %d->%d, states %d->%d", beforeClaims, afterClaims, beforeStates, afterStates)
			}
		})
	}
}

type reconnectDeadlineRepository struct {
	*drainRepository
	muListeners sync.Mutex
	feeds       []chan struct{}
}

func (r *reconnectDeadlineRepository) ExecutionNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	feed := make(chan struct{})
	r.muListeners.Lock()
	r.feeds = append(r.feeds, feed)
	r.muListeners.Unlock()
	return feed, func() {}, nil
}
func TestContinuousRunnerReconnectRescansAfterMissedNotice(t *testing.T) {
	repo := &reconnectDeadlineRepository{drainRepository: &drainRepository{}}
	service := New(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	done := make(chan struct{})
	go func() { defer close(done); _ = service.Run(ctx, &drainEngine{}) }()
	defer func() { cancel(); <-done; service.Close() }()
	deadline := time.Now().Add(time.Second)
	var first chan struct{}
	for time.Now().Before(deadline) {
		repo.muListeners.Lock()
		if len(repo.feeds) > 0 {
			first = repo.feeds[0]
		}
		repo.muListeners.Unlock()
		repo.mu.Lock()
		claims := repo.claims
		repo.mu.Unlock()
		if first != nil && claims > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if first == nil {
		t.Fatal("initial subscription unavailable")
	}
	repo.mu.Lock()
	repo.jobs = append(repo.jobs, execution.Job{JobID: "missed", SubmissionID: "missed", AttemptID: "fenced"})
	repo.mu.Unlock()
	close(first)
	// The missed commit happened across the listener gap; reconnect must resnapshot.
	deadline = time.Now().Add(2500 * time.Millisecond)
	for time.Now().Before(deadline) {
		repo.mu.Lock()
		completed := repo.completed
		repo.mu.Unlock()
		if completed == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("reconnect did not recover the missed job")
}

type heldDrainEngine struct {
	started chan struct{}
	release chan struct{}
}

func (e *heldDrainEngine) Execute(ctx context.Context, job execution.Job) (execution.Completion, error) {
	select {
	case e.started <- struct{}{}:
	default:
	}
	select {
	case <-e.release:
	case <-ctx.Done():
	}
	return execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID}, nil
}
func TestDrainDoesNotRescanDueWorkWhileAllSlotsBusy(t *testing.T) {
	repo := &drainRepository{jobs: []execution.Job{{JobID: "one", SubmissionID: "one", AttemptID: "one"}, {JobID: "two", SubmissionID: "two", AttemptID: "two"}}}
	service := New(repo)
	engine := &heldDrainEngine{started: make(chan struct{}, 2), release: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	done := make(chan struct{})
	go func() { defer close(done); _, _, _ = service.drain(ctx, engine, 1, 2*time.Second) }()
	defer func() { cancel(); <-done; service.Close() }()
	select {
	case <-engine.started:
	case <-ctx.Done():
		t.Fatal("job did not start")
	}
	// Let a timer armed before the worker claimed its slot expire once.
	time.Sleep(500 * time.Millisecond)
	repo.mu.Lock()
	states, claims := repo.states, repo.claims
	repo.mu.Unlock()
	time.Sleep(600 * time.Millisecond)
	repo.mu.Lock()
	afterStates, afterClaims := repo.states, repo.claims
	repo.mu.Unlock()
	if states != afterStates || claims != afterClaims {
		t.Fatalf("busy slots rescanned: states %d->%d claims %d->%d", states, afterStates, claims, afterClaims)
	}
	close(engine.release)
}
