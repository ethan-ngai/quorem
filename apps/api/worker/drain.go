package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

type executionNotifications interface {
	ExecutionNotifications(context.Context) (<-chan struct{}, func(), error)
}
type executionQueueState interface {
	ExecutionQueueState(context.Context) (int, int, error)
	ConfirmExecutionQueueEmpty(context.Context) (bool, error)
}
type DrainState struct {
	Queued  int `json:"queued"`
	Running int `json:"running"`
}

const AdmissionGrace = 15 * time.Second

type claimDeadlineKey struct{}

// WithDrainClaimDeadline limits new claims while leaving running attempts time to finish.
func WithDrainClaimDeadline(ctx context.Context, deadline time.Time) context.Context {
	return context.WithValue(ctx, claimDeadlineKey{}, deadline)
}

// RefreshAdmissionGrace covers another durable wake arriving before its admission commits.
func (s *Service) RefreshAdmissionGrace() {
	select {
	case s.admissionWake <- struct{}{}:
	default:
	}
}

// Drain owns its listeners/workers only for this invocation; idle HTTP mode performs no DB work.
func (s *Service) Drain(ctx context.Context, engine execution.ExecutionEngine, slots int) (DrainState, bool, error) {
	return s.drain(ctx, engine, slots, AdmissionGrace)
}
func (s *Service) drain(parent context.Context, engine execution.ExecutionEngine, slots int, grace time.Duration) (DrainState, bool, error) {
	if slots < 1 || slots > 8 {
		return DrainState{}, false, errors.New("invalid runner concurrency")
	}
	repo, ok := s.store.(executionQueueState)
	if !ok {
		return DrainState{}, false, errors.New("execution state unavailable")
	}
	deadlines, ok := s.store.(executionDeadline)
	if !ok {
		return DrainState{}, false, errors.New("execution deadlines unavailable")
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	claimCtx := ctx
	var stopClaims context.CancelFunc
	if cutoff, ok := parent.Value(claimDeadlineKey{}).(time.Time); ok {
		claimCtx, stopClaims = context.WithDeadline(ctx, cutoff)
		defer stopClaims()
	}
	var notifications <-chan struct{}
	var stop func()
	connect := func() error {
		listener, ok := s.store.(executionNotifications)
		if !ok {
			return errors.New("execution notifications unavailable")
		}
		var err error
		notifications, stop, err = listener.ExecutionNotifications(ctx)
		if err != nil {
			if stop != nil {
				stop()
				stop = nil
			}
			notifications = nil
			return err
		}
		if notifications == nil || stop == nil {
			if stop != nil {
				stop()
				stop = nil
			}
			notifications = nil
			return errors.New("invalid execution notification listener")
		}
		return err
	}
	if err := connect(); err != nil {
		return DrainState{}, false, err
	}
	defer func() {
		if stop != nil {
			stop()
		}
	}()
	work := make(chan struct{}, slots)
	changed := make(chan struct{}, 1)
	failures := make(chan error, 1)
	var group sync.WaitGroup
	var busy atomic.Int32
	defer func() { cancel(); group.Wait() }()
	for i := 0; i < slots; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case <-work:
				}
				busy.Add(1)
				err := func() error {
					if err := s.store.ReconcileBackground(claimCtx); err != nil {
						if claimDeadlineReached(err, claimCtx, ctx) {
							return nil
						}
						return err
					}
					for claimCtx.Err() == nil {
						more, err := s.claimOnceWithContext(claimCtx, ctx, engine)
						if err != nil {
							return err
						}
						select {
						case changed <- struct{}{}:
						default:
						}
						if !more {
							break
						}
					}
					return nil
				}()
				if err != nil {
					select {
					case failures <- err:
					default:
					}
				}
				busy.Add(-1)
				select {
				case changed <- struct{}{}:
				default:
				}
				if err != nil {
					return
				}
			}
		}()
	}
	wake := func() {
		if claimCtx.Err() != nil {
			return
		}
		for i := 0; i < slots; i++ {
			select {
			case work <- struct{}{}:
			default:
			}
		}
	}
	graceUntil := time.Now().Add(grace)
	graceTimer := time.NewTimer(grace)
	extendGrace := func() {
		graceUntil = time.Now().Add(grace)
		if !graceTimer.Stop() {
			select {
			case <-graceTimer.C:
			default:
			}
		}
		graceTimer.Reset(grace)
	}
	defer graceTimer.Stop()
	timer := newQueueTimer()
	defer timer.stop()
	wake()
	var state DrainState
	var cutoff <-chan struct{}
	if stopClaims != nil {
		cutoff = claimCtx.Done()
	}
	for {
		select {
		case <-s.admissionWake:
			extendGrace()
		default:
		}
		query, finish := context.WithTimeout(ctx, 5*time.Second)
		queued, running, err := repo.ExecutionQueueState(query)
		finish()
		if err != nil {
			if parent.Err() != nil {
				return state, false, nil
			}
			return state, false, err
		}
		state = DrainState{Queued: queued, Running: running}
		if state.Queued == 0 && state.Running == 0 && !time.Now().Before(graceUntil) {
			select {
			case <-s.admissionWake:
				extendGrace()
				continue
			default:
			}
			confirmation, finish := context.WithTimeout(ctx, 5*time.Second)
			empty, err := repo.ConfirmExecutionQueueEmpty(confirmation)
			finish()
			if err != nil {
				if parent.Err() != nil {
					return state, false, nil
				}
				return state, false, err
			}
			if !empty {
				wake()
				continue
			}
			// A concurrent pre-admission wake extends grace even if it arrived during the DB fence.
			select {
			case <-s.admissionWake:
				extendGrace()
				continue
			default:
			}
			select {
			case err := <-failures:
				return state, false, err
			default:
			}
			return state, true, nil
		}
		if claimCtx.Err() != nil && ctx.Err() == nil {
			if busy.Load() == 0 && (state.Queued != 0 || state.Running != 0) {
				select {
				case err := <-failures:
					return state, false, err
				default:
				}
				return state, false, nil
			}
			select {
			case <-ctx.Done():
				return state, false, nil
			case err := <-failures:
				return state, false, err
			case <-changed:
			case <-s.admissionWake:
				extendGrace()
			case <-graceTimer.C:
			case _, open := <-notifications:
				if !open {
					notifications = nil
				}
			}
			continue
		}
		query, finish = context.WithTimeout(ctx, 5*time.Second)
		delay, present, err := deadlines.NextExecutionDeadline(query)
		finish()
		if err != nil {
			if parent.Err() != nil {
				return state, false, nil
			}
			return state, false, err
		}
		// Busy workers already drain committed work; their completion rechecks the queue.
		if present && delay <= 0 && busy.Load() == int32(slots) {
			present = false
		}
		timer.set(delay, present)
		select {
		case <-ctx.Done():
			return state, false, nil
		case <-cutoff:
			cutoff = nil
		case err := <-failures:
			return state, false, err
		case <-changed:
		case <-s.admissionWake:
			extendGrace()
		case <-graceTimer.C:
		case <-timer.C:
			wake()
		case _, open := <-notifications:
			if !open {
				if stop != nil {
					stop()
					stop = nil
				}
				notifications = nil
				if err := connect(); err != nil {
					return state, false, err
				}
				// Re-subscribe before the recovery snapshot and claim.
				wake()
			} else {
				timer.resetBackoff()
				wake()
			}
		}
	}
}
