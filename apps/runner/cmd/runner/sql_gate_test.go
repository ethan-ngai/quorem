package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestSQLGateSharesChecksAndRetriesFailure(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	gate := &sqlGate{verify: func(context.Context) error {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return errors.New("preflight failed")
		}
		return nil
	}}
	if err := gate.ensure(context.Background(), "python"); err != nil || calls.Load() != 0 {
		t.Fatal("non-SQL ran preflight")
	}
	result := make(chan error, 1)
	go func() { result <- gate.ensure(context.Background(), "postgresql") }()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := gate.ensure(ctx, "postgresql"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting caller: %v", err)
	}
	close(release)
	if err := <-result; err == nil {
		t.Fatal("expected failed preflight")
	}
	if err := gate.ensure(context.Background(), "postgresql"); err != nil {
		t.Fatal(err)
	}
	if err := gate.ensure(context.Background(), "postgresql"); err != nil || calls.Load() != 2 {
		t.Fatalf("successful check not reused: %d %v", calls.Load(), err)
	}
}
