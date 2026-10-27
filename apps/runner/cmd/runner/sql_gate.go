package main

import (
	"context"
	"log"
	"sync"
	"time"
)

type sqlCheck struct {
	done chan struct{}
	err  error
}
type sqlGate struct {
	mu     sync.Mutex
	check  *sqlCheck
	verify func(context.Context) error
}

func (g *sqlGate) ensure(ctx context.Context, language string) error {
	if language != "postgresql" {
		return nil
	}
	g.mu.Lock()
	check := g.check
	if check != nil {
		g.mu.Unlock()
		select {
		case <-check.done:
			return check.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	check = &sqlCheck{done: make(chan struct{})}
	g.check = check
	g.mu.Unlock()
	started := time.Now()
	err := g.verify(ctx)
	log.Printf("judge initialization phase=postgres-preflight duration_ms=%d success=%t", time.Since(started).Milliseconds(), err == nil)
	g.mu.Lock()
	check.err = err
	if err != nil {
		g.check = nil
	}
	close(check.done)
	g.mu.Unlock()
	return err
}
