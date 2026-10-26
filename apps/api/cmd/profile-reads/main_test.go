package main

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"os"
	"testing"
	"time"
)

func TestReadProfileUsesReadOnlySession(t *testing.T) {
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("isolated fixture database required")
	}
	t.Setenv("DATABASE_URL", url)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.OpenPool(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &postgres.Store{Pool: pool}
	if err = store.Migrate(ctx, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	fixtures, err := problems.LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Seed(ctx, fixtures); err != nil {
		t.Fatal(err)
	}
	report, err := run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !report.ReadOnly || report.CatalogRows < 1 || len(report.Calls) != 3 || len(report.SQL) < 3 {
		t.Fatalf("incomplete read profile: %+v", report)
	}
}
