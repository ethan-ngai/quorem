package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGuestIdentityDatabaseFailureDoesNotRevokeCredential(t *testing.T) {
	// A closed pool reproduces an unavailable dependency without connecting to any database.
	pool, err := pgxpool.New(context.Background(), "postgres://localhost/unavailable_fixture")
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	store := &Store{Pool: pool}
	if _, err := store.GuestIdentity(context.Background(), strings.Repeat("x", 43)); err == nil || errors.Is(err, identity.ErrUnauthorized) {
		t.Fatalf("database failure became revoked credential: %v", err)
	}
	if _, err := store.GuestIdentity(context.Background(), "invalid"); !errors.Is(err, identity.ErrUnauthorized) {
		t.Fatalf("malformed guest credential accepted: %v", err)
	}
}
