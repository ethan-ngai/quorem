package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/access"
)

func TestInterviewGrantIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Capabilities(ctx, "alice")
	if err != nil || c.Interviews {
		t.Fatalf("unexpected interview access: %+v %v", c, err)
	}
	g := access.Grant{OperationID: ID(), UserID: "alice", Actor: "test", Reason: "Pilot", Scope: "interviews.host", Source: "manual", Reference: "interview-pilot"}
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || !c.Interviews || c.HostGuests {
		t.Fatalf("interview grant leaked capabilities: %+v %v", c, err)
	}
	g.OperationID, g.Scope = ID(), "problems.odyssey"
	if err := s.ApplyGrant(ctx, g, false); errorCode(err) != "invalid_input" {
		t.Fatalf("obsolete grant accepted: %v", err)
	}
	grantInternal(t, s, "bob")
	c, err = s.Capabilities(ctx, "bob")
	if err != nil || !c.Interviews {
		t.Fatalf("internal feature bundle: %+v %v", c, err)
	}
}
