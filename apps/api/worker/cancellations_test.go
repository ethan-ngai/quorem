package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

type cancellationTestRepository struct {
	*memoryRepository
	mu        sync.Mutex
	listeners int
	events    chan string
}

func (r *cancellationTestRepository) ExecutionCancellations(context.Context) (<-chan string, func(), error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listeners++
	r.events = make(chan string, 8)
	events := r.events
	return events, func() {}, nil
}

func TestCancellationHubSharesRoutesAndFailsClosed(t *testing.T) {
	repo := &cancellationTestRepository{memoryRepository: &memoryRepository{leaseAlive: true}}
	service := New(repo)
	first, releaseFirst, err := service.subscribeCancellation(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}
	second, releaseSecond, err := service.subscribeCancellation(context.Background(), "two")
	if err != nil {
		t.Fatal(err)
	}
	if repo.listeners != 1 {
		t.Fatalf("listeners: %d", repo.listeners)
	}
	repo.events <- "one"
	select {
	case <-first:
	case <-time.After(time.Second):
		t.Fatal("missing matching wake")
	}
	select {
	case <-second:
		t.Fatal("other job woke")
	default:
	}
	close(repo.events)
	for _, ch := range []<-chan struct{}{first, second} {
		select {
		case _, open := <-ch:
			if open {
				t.Fatal("lost listener did not fail closed")
			}
		case <-time.After(time.Second):
			t.Fatal("listener loss not delivered")
		}
	}
	releaseFirst()
	releaseSecond()
	fresh, releaseFresh, err := service.subscribeCancellation(context.Background(), "three")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseFresh()
	if repo.listeners != 2 {
		t.Fatalf("listener not re-established: %d", repo.listeners)
	}
	repo.events <- "three"
	select {
	case <-fresh:
	case <-time.After(time.Second):
		t.Fatal("missing wake after reconnect")
	}
}

func TestCancellationHubReusesListenerBetweenAdjacentJobs(t *testing.T) {
	repo := &cancellationTestRepository{memoryRepository: &memoryRepository{leaseAlive: true}}
	service := New(repo)
	_, releaseFirst, err := service.subscribeCancellation(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}
	releaseFirst()
	_, releaseSecond, err := service.subscribeCancellation(context.Background(), "two")
	if err != nil {
		t.Fatal(err)
	}
	releaseSecond()
	if repo.listeners != 1 {
		t.Fatalf("adjacent jobs opened %d listeners", repo.listeners)
	}
}

func TestClosingServiceStopsCancellationWatchers(t *testing.T) {
	repo := &cancellationTestRepository{memoryRepository: &memoryRepository{leaseAlive: true}}
	service := New(repo)
	wake, release, err := service.subscribeCancellation(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}
	service.Close()
	select {
	case _, open := <-wake:
		if open {
			t.Fatal("service close did not stop watcher")
		}
	case <-time.After(time.Second):
		t.Fatal("service close hung")
	}
	release()
}

type unavailableCancelRepository struct{ *memoryRepository }

func (*unavailableCancelRepository) ExecutionCancellations(context.Context) (<-chan string, func(), error) {
	return nil, nil, errors.New("unavailable")
}
func TestExecutionNeverStartsWithoutCancellationListener(t *testing.T) {
	repo := &unavailableCancelRepository{memoryRepository: &memoryRepository{job: execution.Job{JobID: "job", SubmissionID: "submission", AttemptID: "attempt"}, leaseAlive: true}}
	engine := &fakeEngine{}
	New(repo).claim(context.Background(), engine)
	if engine.ran != 0 || repo.completion.EngineFailure == "" {
		t.Fatalf("unwatched execution: %+v %+v", engine, repo.completion)
	}
}

func TestExecutionChecksAttemptBeforeStarting(t *testing.T) {
	repo := &memoryRepository{job: execution.Job{JobID: "job", SubmissionID: "submission", AttemptID: "stale"}, leaseAlive: false}
	engine := &fakeEngine{}
	New(repo).claim(context.Background(), engine)
	if engine.ran != 0 {
		t.Fatal("stale or cancelled attempt was executed")
	}
}

func TestListenerLossStopsActiveExecution(t *testing.T) {
	repo := &cancellationTestRepository{memoryRepository: &memoryRepository{leaseAlive: true}}
	service := New(repo)
	started := make(chan struct{})
	engine := &fakeEngine{wait: true, onExecute: func() { close(started) }}
	done := make(chan error, 1)
	go func() {
		done <- service.execute(context.Background(), engine, execution.Job{JobID: "job", SubmissionID: "one", AttemptID: "attempt"}, 0)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("execution did not start")
	}
	close(repo.events)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("execution continued without listener")
	}
}
