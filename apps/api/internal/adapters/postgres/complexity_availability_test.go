package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"strings"
	"testing"
)

func TestComplexityAvailabilityFollowsPublishedRecords(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	if err := s.SeedEditorials(ctx, "../../../../../fixtures/editorials"); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.ComplexityLanguages) == 0 {
		t.Fatalf("catalog omitted published availability: %+v %v", p.ComplexityLanguages, err)
	}
	data, _ := json.Marshal(p)
	for _, field := range []string{"timeComplexity", "spaceComplexity", "complexityNotes", "\"source\""} {
		if strings.Contains(string(data), field) {
			t.Fatalf("availability leaked editorial field %s", field)
		}
	}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Published costs", Question: interviews.QuestionInput{ProblemVersionID: p.ID, Language: "python"}})
	if err != nil || len(v.Question.Problem.ComplexityLanguages) == 0 {
		t.Fatalf("interview omitted published availability: %v", err)
	}
	if _, err = s.Pool.Exec(ctx, "DELETE FROM problem_solutions WHERE version_id=$1", p.ID); err != nil {
		t.Fatal(err)
	}
	p, err = s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.ComplexityLanguages) != 0 {
		t.Fatalf("catalog invented complexity: %v", err)
	}
	v, err = s.Interview(ctx, "alice", v.ID)
	if err != nil || len(v.Question.Problem.ComplexityLanguages) != 0 {
		t.Fatalf("interview retained stale availability: %v", err)
	}
	v, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customInterviewQuestion())
	if err != nil || len(v.Question.Problem.ComplexityLanguages) != 0 {
		t.Fatalf("custom question invented complexity: %v", err)
	}
}

func TestSourceOnlyEditorialPublication(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	c.Problem.Slug = "source-only-editorial"
	c.Solutions = []problems.EditorialSolution{{Language: "python", Source: "class Solution: pass"}}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.PublishQuestionDraftTo(ctx, "alice", d.ID, d.Revision, "private")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, d.PublishedVersionID, true)
	if err != nil || len(p.SolutionLanguages) != 1 || len(p.ComplexityLanguages) != 0 {
		t.Fatalf("availability: %+v %v", p, err)
	}
	items, err := s.Solutions(ctx, p.ID)
	if err != nil || len(items) != 1 || items[0].Source != c.Solutions[0].Source || items[0].TimeComplexity != "" {
		t.Fatalf("solutions: %+v %v", items, err)
	}
	other := identity.With(context.Background(), identity.Principal{UserID: "bob"})
	if _, err := s.Solutions(other, p.ID); errorCode(err) != "not_found" {
		t.Fatalf("private solution exposed: %v", err)
	}
}

func TestPrivateMatchParticipantCanReadAllowedComplexity(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	content := authoringContent(t, s)
	content.Problem.Slug = "private-match-complexity"
	content.Solutions = []problems.EditorialSolution{{Language: "python", Source: "solution", TimeComplexity: "O(n)", SpaceComplexity: "O(1)"}}
	draft, err := s.CreateQuestionDraft(ctx, "alice", content)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = s.PublishQuestionDraftTo(ctx, "alice", draft.ID, draft.Revision, "private")
	if err != nil {
		t.Fatal(err)
	}
	room, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{SelectedProblemVersionID: draft.PublishedVersionID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, room)); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{"alice", "bob"} {
		if _, err = s.ReadyMatch(ctx, user, room.ID, ID(), true); err != nil {
			t.Fatal(err)
		}
	}
	bob := identity.With(context.Background(), identity.Principal{UserID: "bob"})
	items, err := s.Solutions(bob, draft.PublishedVersionID)
	if err != nil || len(items) != 1 || items[0].TimeComplexity != "O(n)" {
		t.Fatalf("participant complexity unavailable: %+v %v", items, err)
	}
	if _, err = s.Problem(bob, draft.PublishedVersionID, true); errorCode(err) != "not_found" {
		t.Fatalf("private catalog access granted: %v", err)
	}
	if _, err = s.QuestionContent(bob, draft.PublishedVersionID); errorCode(err) != "forbidden" {
		t.Fatalf("private authoring content exposed: %v", err)
	}
	outsider := identity.With(context.Background(), identity.Principal{UserID: "charlie"})
	if _, err = s.Solutions(outsider, draft.PublishedVersionID); errorCode(err) != "not_found" {
		t.Fatalf("nonparticipant editorial exposed: %v", err)
	}
}
