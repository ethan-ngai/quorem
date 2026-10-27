package matches

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type idleDeadlineRepository struct {
	wake        chan struct{}
	reads       chan struct{}
	calls       atomic.Int32
	connections atomic.Int32
}

func (r *idleDeadlineRepository) MatchDeadlineNotifications(context.Context) (<-chan struct{}, func(), error) {
	r.connections.Add(1)
	return r.wake, func() {}, nil
}
func (r *idleDeadlineRepository) NextMatchDeadline(context.Context) (time.Duration, bool, error) {
	r.calls.Add(1)
	select {
	case r.reads <- struct{}{}:
	default:
	}
	return 0, false, nil
}

type reconnectDeadlineRepository struct {
	idleDeadlineRepository
	second chan struct{}
}

func (r *reconnectDeadlineRepository) MatchDeadlineNotifications(context.Context) (<-chan struct{}, func(), error) {
	if r.connections.Add(1) == 1 {
		return r.wake, func() {}, nil
	}
	return r.second, func() {}, nil
}

func TestDeadlineSchedulerReconnectsAndRecoversSnapshot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &reconnectDeadlineRepository{idleDeadlineRepository: idleDeadlineRepository{wake: make(chan struct{}), reads: make(chan struct{}, 4)}, second: make(chan struct{})}
	go RunDeadlineScheduler(ctx, r)
	select {
	case <-r.reads:
	case <-time.After(time.Second):
		t.Fatal("initial snapshot missing")
	}
	close(r.wake)
	select {
	case <-r.reads:
	case <-time.After(time.Second):
		t.Fatal("listener loss did not recover")
	}
	if r.connections.Load() < 2 {
		t.Fatal("did not reconnect listener")
	}
}
func (r *idleDeadlineRepository) ReconcileDueMatches(context.Context) (int, error) { return 0, nil }

func TestDeadlineSchedulerSleepsUntilNotification(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &idleDeadlineRepository{wake: make(chan struct{}, 1), reads: make(chan struct{}, 4)}
	go RunDeadlineScheduler(ctx, r)
	select {
	case <-r.reads:
	case <-time.After(time.Second):
		t.Fatal("initial snapshot missing")
	}
	select {
	case <-r.reads:
		t.Fatal("scheduler scanned while idle")
	case <-time.After(1200 * time.Millisecond):
	}
	r.wake <- struct{}{}
	select {
	case <-r.reads:
	case <-time.After(time.Second):
		t.Fatal("notification did not reschedule")
	}
}
