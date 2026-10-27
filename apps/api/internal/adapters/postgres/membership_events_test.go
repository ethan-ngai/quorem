package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func TestMembershipEventsCommitRollbackAndLeave(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `TRUNCATE membership_outbox`); err != nil {
		t.Fatal(err)
	}
	alice, err := s.MembershipRealtimeID(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := s.MembershipRealtimeID(ctx, "bob")
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	var seen []realtime.Notice
	failure := errors.New("unavailable")
	if err = s.DispatchMembershipEvents(ctx, func(realtime.Notice) error { return failure }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if err = s.DispatchMembershipEvents(ctx, func(n realtime.Notice) error { seen = append(seen, n); return nil }); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, n := range seen {
		found[n.AggregateID] = true
		if n.Type != "membership.updated" {
			t.Fatal(n)
		}
	}
	if !found[alice] || !found[bob] {
		t.Fatalf("missing owner notifications: %+v", found)
	}
	if _, err = s.LeaveMatch(ctx, "bob", created.ID, ID()); err != nil {
		t.Fatal(err)
	}
	seen = nil
	if err = s.DispatchMembershipEvents(ctx, func(n realtime.Notice) error { seen = append(seen, n); return nil }); err != nil {
		t.Fatal(err)
	}
	found = map[string]bool{}
	for _, n := range seen {
		found[n.AggregateID] = true
	}
	if !found[bob] || !found[alice] {
		t.Fatalf("leave did not notify both owners: %+v", found)
	}
}
