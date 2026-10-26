package worker

import (
	"context"
	"errors"
	"sync"
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
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var notifications <-chan struct{}
	var stop func()
	connect := func() error {
		listener, ok := s.store.(executionNotifications)
		if !ok {
			return errors.New("execution notifications unavailable")
		}
		var err error
		notifications, stop, err = listener.ExecutionNotifications(ctx)
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
				if err := s.store.ReconcileBackground(ctx); err != nil {
					select {
					case failures <- err:
					default:
					}
					return
				}
				for ctx.Err() == nil {
					more, err := s.pollOnce(ctx, engine)
					if err != nil {
						select {
						case failures <- err:
						default:
						}
						return
					}
					select {
					case changed <- struct{}{}:
					default:
					}
					if !more {
						break
					}
				}
			}
		}()
	}
	wake := func() {
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
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	wake()
	var state DrainState
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
			return state, true, nil
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
		case <-ticker.C:
			if notifications == nil {
				if err := connect(); err != nil {
					return state, false, err
				}
			}
			wake()
		case _, open := <-notifications:
			if !open {
				if stop != nil {
					stop()
					stop = nil
				}
				notifications = nil
			} else {
				wake()
			}
		}
	}
}
