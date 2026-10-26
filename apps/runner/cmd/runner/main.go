package main

import (
	"context"
	"flag"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/apps/runner/internal/engine"
	"github.com/ethan-ngai/quorem/internal/delivery"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func main() {
	verify := flag.Bool("verify-sandbox", false, "Verify runtime isolation and exit before connecting to the database")
	httpMode := flag.Bool("http", false, "Serve bounded authenticated execution drains without idle polling")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *verify {
		if err := (&engine.Docker{Image: env("RUNNER_IMAGE", "quorem-python:local")}).VerifySandbox(ctx); err != nil {
			log.Fatal(err)
		}
		log.Print("Sandbox isolation and teardown verified")
		return
	}
	count, err := strconv.Atoi(env("RUNNER_CONCURRENCY", "2"))
	if err != nil || count < 1 || count > 8 {
		log.Fatal("Invalid runner concurrency")
	}
	token := os.Getenv("QUOREM_JUDGE_CONTROL_TOKEN")
	if *httpMode && len(token) < 32 {
		log.Fatal("Judge control token requires at least 32 characters")
	}
	var queue delivery.Queue
	if !*httpMode {
		queue, err = delivery.FromEnv(ctx, os.Getenv)
		if err != nil {
			log.Fatal("Invalid delivery configuration")
		}
	}
	service, err := worker.Open(ctx, env("DATABASE_URL", "postgres://quorem:quorem@127.0.0.1:54329/quorem?sslmode=disable"), worker.WithQueue(queue))
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()
	docker := &engine.Docker{Image: env("RUNNER_IMAGE", "quorem-python:local"), Resolve: service.Load, Images: map[string]string{"java": env("RUNNER_JAVA_IMAGE", "quorem-java:local"), "typescript": env("RUNNER_TYPESCRIPT_IMAGE", "quorem-typescript:local"), "ocaml": env("RUNNER_OCAML_IMAGE", "quorem-ocaml:local")}}
	if *httpMode {
		server := &http.Server{Addr: env("RUNNER_ADDR", "127.0.0.1:8090"), Handler: drainHandler(service, docker, count, token), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 240 * time.Second, IdleTimeout: 30 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
		shutdownDone := make(chan struct{})
		go func() {
			defer close(shutdownDone)
			<-ctx.Done()
			shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdown)
		}()
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
		<-shutdownDone
		return
	}
	var group sync.WaitGroup
	for i := 0; i < count; i++ {
		group.Add(1)
		go func() { defer group.Done(); service.Run(ctx, docker) }()
	}
	log.Printf("Runner started: %d development Docker slots", count)
	group.Wait()
}
