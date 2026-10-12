package main

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/apps/runner/internal/engine"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	count, err := strconv.Atoi(env("RUNNER_CONCURRENCY", "2"))
	if err != nil || count < 1 || count > 8 {
		log.Fatal("Invalid runner concurrency")
	}
	service, err := worker.Open(ctx, env("DATABASE_URL", "postgres://quorem:quorem@127.0.0.1:54329/quorem?sslmode=disable"))
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()
	docker := &engine.Docker{Image: env("RUNNER_IMAGE", "quorem-python:local"), Resolve: service.Load, Images: map[string]string{"java": env("RUNNER_JAVA_IMAGE", "quorem-java:local"), "typescript": env("RUNNER_TYPESCRIPT_IMAGE", "quorem-typescript:local"), "ocaml": env("RUNNER_OCAML_IMAGE", "quorem-ocaml:local")}}
	var group sync.WaitGroup
	for i := 0; i < count; i++ {
		group.Add(1)
		go func() { defer group.Done(); service.Run(ctx, docker) }()
	}
	log.Printf("Runner started: %d development Docker slots", count)
	group.Wait()
}
