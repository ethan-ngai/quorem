package worker

import (
	"context"
	"errors"
	"sync"
	"time"
)

type cancellationNotifications interface {
	ExecutionCancellations(context.Context) (<-chan string, func(), error)
}

type cancellationHub struct {
	stop     func()
	watchers map[string]map[chan struct{}]struct{}
	idle     *time.Timer
}

// subscribeCancellation shares a session across active jobs; loss cancels all subscribers.
func (s *Service) subscribeCancellation(ctx context.Context, submission string) (<-chan struct{}, func(), error) {
	source, ok := s.store.(cancellationNotifications)
	if !ok {
		return nil, nil, errors.New("cancellation notifications unavailable")
	}
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	hub := s.cancelHub
	if hub == nil {
		lifetime, stop := context.WithCancel(context.Background())
		events, closeListener, err := source.ExecutionCancellations(lifetime)
		if err != nil {
			stop()
			return nil, nil, err
		}
		hub = &cancellationHub{watchers: make(map[string]map[chan struct{}]struct{}), stop: func() { stop(); closeListener() }}
		s.cancelHub = hub
		go s.dispatchCancellations(hub, events)
	}
	if hub.idle != nil {
		hub.idle.Stop()
		hub.idle = nil
	}
	wake := make(chan struct{}, 1)
	if hub.watchers[submission] == nil {
		hub.watchers[submission] = make(map[chan struct{}]struct{})
	}
	hub.watchers[submission][wake] = struct{}{}
	var once sync.Once
	release := func() {
		once.Do(func() {
			s.cancelMu.Lock()
			defer s.cancelMu.Unlock()
			delete(hub.watchers[submission], wake)
			if len(hub.watchers[submission]) == 0 {
				delete(hub.watchers, submission)
			}
			if len(hub.watchers) == 0 && s.cancelHub == hub {
				// Reuse the session for adjacent jobs without retaining idle HTTP runners.
				hub.idle = time.AfterFunc(5*time.Second, func() {
					s.cancelMu.Lock()
					defer s.cancelMu.Unlock()
					if s.cancelHub == hub && len(hub.watchers) == 0 {
						s.cancelHub = nil
						hub.stop()
					}
				})
			}
		})
	}
	return wake, release, nil
}

func (s *Service) dispatchCancellations(hub *cancellationHub, events <-chan string) {
	for submission := range events {
		s.cancelMu.Lock()
		if s.cancelHub != hub {
			s.cancelMu.Unlock()
			return
		}
		for wake := range hub.watchers[submission] {
			select {
			case wake <- struct{}{}:
			default:
			}
		}
		s.cancelMu.Unlock()
	}
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	if s.cancelHub != hub {
		return
	}
	s.cancelHub = nil
	if hub.idle != nil {
		hub.idle.Stop()
	}
	hub.stop()
	for _, listeners := range hub.watchers {
		for wake := range listeners {
			close(wake)
		}
	}
}

func (s *Service) closeCancellations() {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	hub := s.cancelHub
	if hub == nil {
		return
	}
	s.cancelHub = nil
	if hub.idle != nil {
		hub.idle.Stop()
	}
	hub.stop()
	for _, listeners := range hub.watchers {
		for wake := range listeners {
			close(wake)
		}
	}
}
