package main

import (
	"context"
	"flag"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/httpapi"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
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
	seed := flag.Bool("seed", false, "Migrate and seed, then exit")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	addr := env("API_ADDR", "127.0.0.1:8080")
	host, _, err := net.SplitHostPort(addr)
	if err != nil || !net.ParseIP(host).IsLoopback() || env("APP_ENV", "local") != "local" {
		log.Fatal("Development API must bind loopback in APP_ENV=local")
	}
	store, err := postgres.Open(ctx, env("DATABASE_URL", "postgres://quorem:quorem@127.0.0.1:54329/quorem?sslmode=disable"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Pool.Close()
	if err = store.Migrate(ctx, "apps/api/migrations"); err != nil {
		log.Fatal(err)
	}
	fixtures, err := problems.LoadFixtures("fixtures/problems")
	if err != nil {
		log.Fatal(err)
	}
	if err = store.Seed(ctx, fixtures); err != nil {
		log.Fatal(err)
	}
	if err = store.Cleanup(ctx); err != nil {
		log.Fatal(err)
	}
	if *seed {
		return
	}
	api := &httpapi.Server{Store: store, Local: true}
	api.StartRealtime(ctx)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			if e := store.ReconcileMatches(ctx); e != nil && ctx.Err() == nil {
				log.Print("Match reconciliation unavailable")
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	server := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("Local API listening %s", addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
