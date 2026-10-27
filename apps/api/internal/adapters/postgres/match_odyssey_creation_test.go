package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestCreateMatchWithPublicOdyssey(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	data, err := os.ReadFile("../../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var content problems.QuestionContent
	if err = json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateQuestionDraft(ctx, "alice", content)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = s.PublishQuestionDraftTo(ctx, "alice", draft.ID, draft.Revision, "global")
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulties: []string{"easy"}, SelectedProblemVersionID: draft.PublishedVersionID})
	if err != nil || created.ID == "" {
		t.Fatalf("public Odyssey creation: %+v %v", created, err)
	}
}
