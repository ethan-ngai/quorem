package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
)

func TestRandomMatchUsesPersistedCatalogFilters(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	execSQL(t, s, `INSERT INTO companies(name) VALUES('Random Filter Test') ON CONFLICT (lower(name)) DO NOTHING;
 INSERT INTO problem_companies(problem_id,company_id) SELECT p.id,c.id FROM problems p JOIN companies c ON c.name='Random Filter Test' WHERE p.slug='run-widths' ON CONFLICT DO NOTHING`)
	settings := matches.Settings{Mode: matches.FreeForAll, Difficulties: []string{"easy"}, QuestionFilters: matches.QuestionFilters{Type: "classic", Topic: "arrays", Company: "Random Filter Test"}}
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulties: []string{"easy"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateMatchSettings(ctx, "alice", created.ID, ID(), settings); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.Match(ctx, "alice", created.ID)
	if err != nil || snapshot.QuestionFilters != settings.QuestionFilters {
		t.Fatalf("filters not persisted: %+v %v", snapshot.QuestionFilters, err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{"alice", "bob"} {
		if _, err = s.ReadyMatch(ctx, user, created.ID, ID(), true); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err = s.StartMatch(ctx, "alice", created.ID, ID())
	problem, lookupErr := s.Problem(ctx, "run-widths", false)
	if err != nil || lookupErr != nil || snapshot.ProblemVersionID != problem.ID {
		t.Fatalf("random choice: %+v %v %v", snapshot, err, lookupErr)
	}
}

func TestEmptyRandomPoolExplainsFailureAndRetainsReadiness(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulties: []string{"easy"}, QuestionFilters: matches.QuestionFilters{Company: "No matching company"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "alice", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	retryKey := ID()
	if _, err = s.ReadyMatch(ctx, "bob", created.ID, retryKey, true); errorCode(err) != "no_matching_questions" {
		t.Fatalf("wrong error: %v", err)
	}
	snapshot, err := s.Match(ctx, "alice", created.ID)
	if err != nil || snapshot.State == "active" || !snapshot.Participants[0].Ready || snapshot.Participants[1].Ready {
		t.Fatalf("readiness changed on failure: %+v %v", snapshot, err)
	}
	if _, err = s.UpdateMatchSettings(ctx, "alice", created.ID, ID(), matches.Settings{Difficulties: []string{"easy"}}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "alice", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	started, err := s.ReadyMatch(ctx, "bob", created.ID, retryKey, true)
	if err != nil || started.State != "active" {
		t.Fatalf("retry after changing filters: %+v %v", started, err)
	}
}
