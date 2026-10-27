package main

import (
	"context"
	"flag"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/eventbus"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/httpapi"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/delivery"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func capacity(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 4096 {
		log.Fatalf("%s must be between 1 and 4096", name)
	}
	return n
}
func main() {
	seed := flag.Bool("seed", false, "Migrate and seed, then exit")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	addr := env("API_ADDR", "127.0.0.1:8080")
	host, _, err := net.SplitHostPort(addr)
	local := env("QUOREM_DEV_IDENTITY", "false") == "true"
	if err != nil || (local && (!net.ParseIP(host).IsLoopback() || env("APP_ENV", "production") != "local")) {
		log.Fatal("Development API must bind loopback in APP_ENV=local")
	}
	store, err := postgres.Open(ctx, env("DATABASE_URL", "postgres://quorem:quorem@127.0.0.1:54329/quorem?sslmode=disable"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Pool.Close()
	skipMigrations := env("QUOREM_SKIP_MIGRATIONS", "false") == "true" && !*seed
	if !skipMigrations {
		if err = store.Migrate(ctx, "apps/api/migrations"); err != nil {
			log.Fatal(err)
		}
	}
	if local || (*seed && env("APP_ENV", "production") == "local") {
		fixtures, err := problems.LoadFixtures("fixtures/problems")
		if err != nil {
			log.Fatal(err)
		}
		if err = store.Seed(ctx, fixtures); err != nil {
			log.Fatal(err)
		}
		if err = store.SeedEditorials(ctx, "fixtures/editorials"); err != nil {
			log.Fatal(err)
		}
		if err = store.SealProblemVersions(ctx); err != nil {
			log.Fatal(err)
		}
	}
	if !skipMigrations {
		if err = store.Cleanup(ctx); err != nil {
			log.Fatal(err)
		}
	}
	if *seed {
		return
	}
	pilotDefault := "false"
	if env("APP_ENV", "production") == "local" {
		pilotDefault = "true"
	}
	api := &httpapi.Server{Store: store, Local: local, Origins: strings.Split(os.Getenv("AUTH_ORIGIN"), ","), GuestCreation: env("GUEST_CREATION_ENABLED", pilotDefault) == "true", GuestAdmission: env("GUEST_ADMISSION_ENABLED", pilotDefault) == "true", GuestExecution: env("GUEST_EXECUTION_ENABLED", pilotDefault) == "true"}
	if env("APP_ENV", "production") == "local" {
		addresses, err := net.InterfaceAddrs()
		if err != nil {
			log.Fatal(err)
		}
		api.Origins = localOrigins(api.Origins, addresses)
	}
	api.PublicGuestRequest = store.GuestRequestAllowed
	if !local {
		issuer := os.Getenv("AUTH_ORIGIN")
		secret := os.Getenv("AUTH_INTERNAL_SECRET")
		authURL := os.Getenv("AUTH_SERVICE_URL")
		if issuer == "" || secret == "" || authURL == "" {
			log.Fatal("Managed identity requires AUTH_ORIGIN, AUTH_SERVICE_URL, AUTH_INTERNAL_SECRET")
		}
		api.Identity = &identity.JWTVerifier{Issuer: issuer, Audience: "quorem-api", JWKSURL: authURL + "/api/auth/jwks", Resolve: sessionResolver(authURL, secret, store.ResolveIdentity)}
	}
	queue, err := delivery.PublisherFromEnv(ctx, os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	if queue != nil {
		api.NotifyExecution = func(ctx context.Context, jobID string) error {
			return queue.Publish(ctx, delivery.Notification{JobID: jobID})
		}
	}
	api.RequireExecutionWake = env("QUOREM_REQUIRE_EXECUTION_WAKE", "false") == "true"
	if api.RequireExecutionWake && queue == nil {
		log.Fatal("Required execution wake publisher is missing")
	}
	api.Events, err = eventbus.FromEnv(ctx, os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	if env("QUOREM_REALTIME_PROVIDER", "") == "postgres-notify" {
		api.Presence = postgres.NewPresence(ctx, store.Pool)
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := store.Cleanup(ctx); err != nil && ctx.Err() == nil {
					log.Print("Retention cleanup unavailable")
				}
			}
		}
	}()
	if err = api.StartRealtime(ctx); err != nil {
		log.Fatal(err)
	}
	api.StartMembershipRealtime(ctx)
	go matches.RunDeadlineScheduler(ctx, store)
	server := &http.Server{Addr: addr, Handler: httpapi.WithCapacity(api.Handler(), capacity("QUOREM_API_MAX_REQUESTS", 32), capacity("QUOREM_REALTIME_CONNECTION_LIMIT", 512)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("API listening %s", addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
