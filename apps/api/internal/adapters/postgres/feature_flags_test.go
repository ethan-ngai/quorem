package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/access"
)

func TestInterviewOdysseyGrantsAreIndependent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id='alice'"); err != nil {
		t.Fatal(err)
	}
	c, err := s.Capabilities(ctx, "alice")
	if err != nil || c.Interviews || c.Odyssey {
		t.Fatalf("admin must not imply feature access: %+v %v", c, err)
	}
	g := access.Grant{OperationID: ID(), UserID: "alice", Actor: "test", Reason: "Pilot", Scope: "interviews.host", Source: "manual", Reference: "interview-pilot"}
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || !c.Interviews || c.Odyssey || c.HostGuests {
		t.Fatalf("interview grant leaked capabilities: %+v %v", c, err)
	}
	g.OperationID, g.Scope, g.Reference = ID(), "problems.odyssey", "odyssey-pilot"
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || !c.Interviews || !c.Odyssey {
		t.Fatalf("independent grants: %+v %v", c, err)
	}
	g.OperationID, g.Revoke = ID(), true
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || !c.Interviews || c.Odyssey {
		t.Fatalf("revocation crossed scopes: %+v %v", c, err)
	}
	g.OperationID, g.Revoke = ID(), false
	past := time.Now().Add(-time.Hour)
	g.ExpiresAt = &past
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || c.Odyssey {
		t.Fatalf("expired grant usable: %+v %v", c, err)
	}
	grantInternal(t, s, "bob")
	c, err = s.Capabilities(ctx, "bob")
	if err != nil || !c.Interviews || !c.Odyssey {
		t.Fatalf("internal feature bundle: %+v %v", c, err)
	}
}
