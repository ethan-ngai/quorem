package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/httpapi"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
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
	if err = store.Migrate(ctx, "apps/api/migrations"); err != nil {
		log.Fatal(err)
	}
	if local {
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
	if err = store.Cleanup(ctx); err != nil {
		log.Fatal(err)
	}
	if *seed {
		return
	}
	api := &httpapi.Server{Store: store, Local: local, Origins: strings.Split(os.Getenv("AUTH_ORIGIN"), ",")}
	if !local {
		issuer := os.Getenv("AUTH_ORIGIN")
		secret := os.Getenv("AUTH_INTERNAL_SECRET")
		authURL := os.Getenv("AUTH_SERVICE_URL")
		if issuer == "" || secret == "" || authURL == "" {
			log.Fatal("Managed identity requires AUTH_ORIGIN, AUTH_SERVICE_URL, AUTH_INTERNAL_SECRET")
		}
		api.Identity = &identity.JWTVerifier{Issuer: issuer, Audience: "quorem-api", JWKSURL: authURL + "/api/auth/jwks", Resolve: func(ctx context.Context, c identity.Claims) (identity.Principal, error) {
			req, e := http.NewRequestWithContext(ctx, "GET", authURL+"/internal/session/"+c.SessionID, nil)
			if e != nil {
				return identity.Principal{}, e
			}
			req.Header.Set("Authorization", "Bearer "+secret)
			req.Header.Set("X-Auth-Subject", c.Subject)
			response, e := (&http.Client{Timeout: 3 * time.Second}).Do(req)
			if e != nil {
				return identity.Principal{}, e
			}
			response.Body.Close()
			if response.StatusCode != 204 {
				return identity.Principal{}, fmt.Errorf("session unavailable")
			}
			return store.ResolveIdentity(ctx, c)
		}}
	}
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
