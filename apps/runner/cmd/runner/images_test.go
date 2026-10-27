package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestImageLoaderSharesLoadsAndRetriesFailure(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	l := &imageLoader{loads: make(map[string]*imageLoad), load: func(context.Context, string) error {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return errors.New("load failed")
		}
		return nil
	}}
	result := make(chan error, 1)
	go func() { result <- l.ensure(context.Background(), "java") }()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := l.ensure(ctx, "java"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting caller: %v", err)
	}
	close(release)
	if err := <-result; err == nil {
		t.Fatal("expected load failure")
	}
	if err := l.ensure(context.Background(), "java"); err != nil {
		t.Fatal(err)
	}
	if err := l.ensure(context.Background(), "java"); err != nil || calls.Load() != 2 {
		t.Fatalf("successful load not reused: calls=%d err=%v", calls.Load(), err)
	}
}
