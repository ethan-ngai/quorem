package main

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"sync"
)

type imageLoad struct {
	done chan struct{}
	err  error
}

type imageLoader struct {
	mu    sync.Mutex
	loads map[string]*imageLoad
	load  func(context.Context, string) error
}

func newImageLoader(directory string) *imageLoader {
	return &imageLoader{loads: make(map[string]*imageLoad), load: func(ctx context.Context, language string) error {
		return exec.CommandContext(ctx, "docker", "load", "-i", filepath.Join(directory, language+".tar")).Run()
	}}
}

func (l *imageLoader) ensure(ctx context.Context, language string) error {
	if language == "python" || language == "postgresql" {
		return nil // Loaded and verified by the supervisor before the runner starts.
	}
	if language != "java" && language != "typescript" && language != "ocaml" {
		return errors.New("unsupported image language")
	}
	l.mu.Lock()
	load := l.loads[language]
	if load != nil {
		l.mu.Unlock()
		select {
		case <-load.done:
			return load.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	load = &imageLoad{done: make(chan struct{})}
	l.loads[language] = load
	l.mu.Unlock()

	err := l.load(ctx, language)
	l.mu.Lock()
	load.err = err
	if err != nil {
		delete(l.loads, language)
	}
	close(load.done)
	l.mu.Unlock()
	return err
}
