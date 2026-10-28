package worker

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

type cutoffEngine struct {
	started chan string
	release chan struct{}
	calls   atomic.Int32
}

func (e *cutoffEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	e.calls.Add(1)
	e.started <- j.JobID
	select {
	case <-e.release:
		return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID}, nil
	case <-ctx.Done():
		return execution.Completion{}, ctx.Err()
	}
}

type drainResult struct {
	state    DrainState
	complete bool
	err      error
}

func startCutoffDrain(s *Service, e execution.ExecutionEngine, slots int, cutoff time.Time) <-chan drainResult {
	done := make(chan drainResult, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		ctx = WithDrainClaimDeadline(ctx, cutoff)
		state, complete, err := s.drain(ctx, e, slots, time.Millisecond)
		done <- drainResult{state, complete, err}
	}()
	return done
}
func TestDrainCutoffWaitsForActiveAttemptsAndRetriesQueued(t *testing.T) {
	for _, slots := range []int{1, 2} {
		t.Run(string(rune('0'+slots)), func(t *testing.T) {
			jobs := []execution.Job{{JobID: "first", SubmissionID: "one", AttemptID: "a"}, {JobID: "second", SubmissionID: "two", AttemptID: "b"}, {JobID: "third", SubmissionID: "three", AttemptID: "c"}}
			if slots == 1 {
				jobs = jobs[:2]
			}
			repo := &drainRepository{jobs: jobs}
			engine := &cutoffEngine{started: make(chan string, 3), release: make(chan struct{}, 2)}
			deadline := time.Now().Add(100 * time.Millisecond)
			done := startCutoffDrain(New(repo), engine, slots, deadline)
			for i := 0; i < slots; i++ {
				select {
				case <-engine.started:
				case <-time.After(time.Second):
					t.Fatal("missing claimed attempt")
				}
			}
			<-time.After(time.Until(deadline) + 20*time.Millisecond)
			engine.release <- struct{}{}
			if slots == 2 {
				select {
				case r := <-done:
					t.Fatalf("returned while another attempt was active: %+v", r)
				case <-time.After(30 * time.Millisecond):
				}
				engine.release <- struct{}{}
			}
			result := <-done
			if result.err != nil || result.complete || result.state.Queued != 1 || result.state.Running != 0 || engine.calls.Load() != int32(slots) {
				t.Fatalf("incomplete drain: %+v calls=%d", result, engine.calls.Load())
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			engine.release <- struct{}{}
			state, complete, err := New(repo).drain(ctx, engine, slots, time.Millisecond)
			if err != nil || !complete || state.Queued != 0 || engine.calls.Load() != int32(slots+1) {
				t.Fatalf("retry: %+v %v %v calls=%d", state, complete, err, engine.calls.Load())
			}
		})
	}
}

type blockedClaimRepository struct {
	*drainRepository
	entered chan struct{}
}

func (r *blockedClaimRepository) Claim(ctx context.Context) (execution.Job, error) {
	select {
	case r.entered <- struct{}{}:
	default:
	}
	<-ctx.Done()
	return execution.Job{}, ctx.Err()
}
func TestDrainCutoffInterruptsBlockedClaim(t *testing.T) {
	repo := &blockedClaimRepository{drainRepository: &drainRepository{jobs: []execution.Job{{JobID: "queued"}}}, entered: make(chan struct{}, 1)}
	engine := &cutoffEngine{started: make(chan string, 1), release: make(chan struct{}, 1)}
	done := startCutoffDrain(New(repo), engine, 1, time.Now().Add(80*time.Millisecond))
	select {
	case <-repo.entered:
	case <-time.After(time.Second):
		t.Fatal("claim never started")
	}
	result := <-done
	if result.err != nil || result.complete || result.state.Queued != 1 || engine.calls.Load() != 0 {
		t.Fatalf("blocked claim: %+v", result)
	}
}
func TestClaimDeadlineDoesNotHideTeardownFailure(t *testing.T) {
	repo := &memoryRepository{job: execution.Job{JobID: "job", AttemptID: "attempt"}, leaseAlive: true}
	claimCtx, cancel := context.WithCancel(context.Background())
	engine := &fakeEngine{err: ErrTeardown, onExecute: cancel}
	_, err := New(repo).claimOnceWithContext(claimCtx, context.Background(), engine)
	if !errors.Is(err, ErrTeardown) {
		t.Fatalf("teardown error lost: %v", err)
	}
}
