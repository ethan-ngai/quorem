package httpapi

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func TestOutboxDispatcherWakesRetriesAndReconnects(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := realtime.NewMemory()
	defer bus.Close()
	server := &Server{Events: bus}
	first, second := make(chan struct{}, 1), make(chan struct{}, 1)
	var connections, calls atomic.Int32
	results := make(chan int32, 16)
	listener := func(context.Context) (<-chan struct{}, func(), error) {
		if connections.Add(1) == 1 {
			return first, func() {}, nil
		}
		return second, func() {}, nil
	}
	publish := func(context.Context, func(realtime.Notice) error) error {
		n := calls.Add(1)
		results <- n
		if n == 2 {
			return errors.New("temporary publisher failure")
		}
		return nil
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		server.runOutboxDispatcher(ctx, "/test/", publish, listener, 10*time.Millisecond, 40*time.Millisecond)
	}()
	wait := func(want int32) {
		t.Helper()
		select {
		case got := <-results:
			if got != want {
				t.Fatalf("dispatch=%d want=%d", got, want)
			}
		case <-time.After(time.Second):
			t.Fatal("dispatch did not run")
		}
	}
	wait(1)
	select {
	case <-results:
		t.Fatal("idle dispatcher polled")
	case <-time.After(1100 * time.Millisecond):
	}
	first <- struct{}{}
	wait(2)
	wait(3) // Failure retries without another database notification.
	close(first)
	wait(4) // Reconnecting subscribes before draining potentially missed commits.
	if connections.Load() != 2 {
		t.Fatalf("connections=%d", connections.Load())
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("dispatcher did not stop")
	}
}

func TestRealtimeRejectsStoreWithoutNotifications(t *testing.T) {
	if err := (&Server{}).StartRealtime(context.Background()); err == nil {
		t.Fatal("missing outbox listener accepted")
	}
}
