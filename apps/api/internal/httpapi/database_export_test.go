package httpapi

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/jackc/pgx/v5"
)

// NewHTTPTestDatabase isolates public-schema migrations and their ledger per test.
func NewHTTPTestDatabase(t *testing.T) *postgres.Store {
	t.Helper()
	dsn := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL required")
	}
	target, err := url.Parse(dsn)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || target.Host == "" {
		t.Fatal("invalid disposable test database URL")
	}
	for key := range target.Query() {
		switch strings.ToLower(key) {
		case "host", "hostaddr", "port", "service", "servicefile", "dbname", "database", "search_path", "options":
			t.Fatal("test database URL cannot override routing or schema")
		}
	}
	ctx := context.Background()
	admin, err := postgres.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := "http_test_" + strings.ReplaceAll(postgres.ID(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Pool.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		admin.Pool.Close()
		t.Fatal(err)
	}
	var store *postgres.Store
	t.Cleanup(func() {
		if store != nil {
			store.Pool.Close()
		}
		if _, err := admin.Pool.Exec(context.Background(), "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop owned HTTP test database: %v", err)
		}
		admin.Pool.Close()
	})
	target.Path = "/" + name
	target.RawPath = ""
	store, err = postgres.Open(ctx, target.String())
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestHTTPTestDatabaseUsesOwnPublicLedger(t *testing.T) {
	store := NewHTTPTestDatabase(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	var database, schema string
	var users, ledger bool
	if err := store.Pool.QueryRow(ctx, `SELECT current_database(), current_schema(), to_regclass('public.users') IS NOT NULL, to_regclass('public.schema_migrations') IS NOT NULL`).Scan(&database, &schema, &users, &ledger); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(database, "http_test_") || schema != "public" || !users || !ledger {
		t.Fatal("owned public database migrations unavailable")
	}
}
