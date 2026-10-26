package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"testing"
	"time"
)

func TestIdentityBindingStableRolesAndDisable(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c := identity.Claims{Issuer: "mock-" + ID(), Subject: "cognito-sub", SessionID: "session", EmailVerified: true, Name: "Verified user"}
	p, e := s.ResolveIdentity(ctx, c)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.ResolveIdentity(ctx, c)
	if e != nil || p.UserID != again.UserID || p.Admin {
		t.Fatal("unstable binding", again, e)
	}
	c.Image = "/api/auth/profile-photos/example.webp"
	if _, e = s.ResolveIdentity(ctx, c); e != nil {
		t.Fatal(e)
	}
	var image string
	if e = s.Pool.QueryRow(ctx, "SELECT profile_image FROM users WHERE id=$1", p.UserID).Scan(&image); e != nil || image != c.Image {
		t.Fatal("photo projection", image, e)
	}
	c.Image = ""
	if _, e = s.ResolveIdentity(ctx, c); e != nil {
		t.Fatal(e)
	}
	if e = s.Pool.QueryRow(ctx, "SELECT profile_image FROM users WHERE id=$1", p.UserID).Scan(&image); e != nil || image != "" {
		t.Fatal("photo removal", image, e)
	}
	c.Color, c.ColorRevision = 5, 20
	if _, e = s.ResolveIdentity(ctx, c); e != nil {
		t.Fatal(e)
	}
	older := c
	older.Color, older.ColorRevision = 2, 10
	if _, e = s.ResolveIdentity(ctx, older); e != nil {
		t.Fatal(e)
	}
	var color int
	if e = s.Pool.QueryRow(ctx, "SELECT profile_color FROM users WHERE id=$1", p.UserID).Scan(&color); e != nil || color != 5 {
		t.Fatal("stale color projection", color, e)
	}
	_, e = s.Pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id=$1", p.UserID)
	if e != nil {
		t.Fatal(e)
	}
	admin, e := s.ResolveIdentity(ctx, c)
	if e != nil || !admin.Admin {
		t.Fatal("server role", e)
	}
	other := c
	other.Subject = "different-immutable-subject"
	otherUser, e := s.ResolveIdentity(ctx, other)
	if e != nil || otherUser.UserID == p.UserID {
		t.Fatal("merged matching profiles", e)
	}
	_, e = s.Pool.Exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", p.UserID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ResolveIdentity(ctx, c); e == nil {
		t.Fatal("disabled accepted")
	}
}

func TestBoundIdentityReadDoesNotWaitForProjectionLock(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c := identity.Claims{Issuer: "mock-" + ID(), Subject: "subject", SessionID: "session", EmailVerified: true, Name: "Verified user"}
	want, err := s.ResolveIdentity(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", c.Issuer+":"+c.Subject); err != nil {
		t.Fatal(err)
	}
	read, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	got, err := s.ResolveIdentity(read, c)
	if err != nil || got.UserID != want.UserID {
		t.Fatalf("unchanged identity read blocked behind projection: %v, %v", got, err)
	}
}
