package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"testing"
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
