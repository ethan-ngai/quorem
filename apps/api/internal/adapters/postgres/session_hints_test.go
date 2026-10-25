package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"strings"
	"testing"
)

func TestInterviewHintsPersistAndPreserveDocument(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	no, yes := false, true
	q := customInterviewQuestion()
	q.Hints = &problems.HintVisibility{Topics: &no, Complexity: &yes}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Hint settings", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	if v.Hints.TopicsAllowed() || !v.Hints.ComplexityAllowed() {
		t.Fatalf("creation lost hints: %+v", v.Hints)
	}
	bob, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.Invites.Interviewer, "/interview-invite/"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if bob.Hints.TopicsAllowed() {
		t.Fatal("member did not receive hint policy")
	}
	if _, err = s.SetInterviewHints(ctx, "bob", v.ID, ID(), problems.HintVisibility{Topics: &yes}); errorCode(err) != "forbidden" {
		t.Fatalf("nonhost changed hints: %v", err)
	}
	key := ID()
	next, err := s.SetInterviewHints(ctx, "alice", v.ID, key, problems.HintVisibility{Topics: &yes, Complexity: &no})
	if err != nil {
		t.Fatal(err)
	}
	if next.Document != v.Document || next.QuestionEpoch != v.QuestionEpoch {
		t.Fatal("hint update changed shared document or question epoch")
	}
	if !next.Hints.TopicsAllowed() || next.Hints.ComplexityAllowed() {
		t.Fatal("hint update not persisted")
	}
	retry, err := s.SetInterviewHints(ctx, "alice", v.ID, key, problems.HintVisibility{Topics: &yes, Complexity: &no})
	if err != nil || retry.Version != next.Version {
		t.Fatalf("retry changed version: %v", err)
	}
	read, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || !read.Hints.TopicsAllowed() || read.Hints.ComplexityAllowed() {
		t.Fatalf("member policy stale: %v", err)
	}
	restricted, err := s.SetInterviewHints(ctx, "alice", v.ID, ID(), problems.HintVisibility{Topics: &no, Complexity: &yes})
	if err != nil {
		t.Fatal(err)
	}
	switched, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", restricted.Document.Epoch)
	if err != nil || switched.Hints.TopicsAllowed() || !switched.Hints.ComplexityAllowed() {
		t.Fatalf("language switch lost host hints: %v", err)
	}
	// A co-interviewer can replace questions, but cannot change host disclosures through that route.
	var versionID string
	if err = s.Pool.QueryRow(ctx, "SELECT current_version_id::text FROM problems WHERE owner_id IS NULL LIMIT 1").Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	q = interviews.QuestionInput{Language: "python", ProblemVersionID: versionID, Hints: &problems.HintVisibility{Topics: &yes}}
	if _, err = s.UpdateInterviewQuestion(ctx, "bob", v.ID, ID(), q); errorCode(err) != "forbidden" {
		t.Fatalf("question replacement bypassed host: %v", err)
	}
}

func TestMatchHintsPersistInLobbySettings(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	no, yes := false, true
	settings := matches.Settings{Difficulty: "easy", Rules: matches.Rules{Hints: &problems.HintVisibility{Topics: &no, Complexity: &yes}}}
	created, err := s.CreateMatch(ctx, "alice", ID(), settings)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.Match(ctx, "alice", created.ID)
	if err != nil || v.Rules.Hints.TopicsAllowed() || !v.Rules.Hints.ComplexityAllowed() {
		t.Fatalf("created lobby lost hints: %v", err)
	}
	settings.Rules.Hints = &problems.HintVisibility{Topics: &yes, Complexity: &no}
	v, err = s.UpdateMatchSettings(ctx, "alice", created.ID, ID(), settings)
	if err != nil || !v.Rules.Hints.TopicsAllowed() || v.Rules.Hints.ComplexityAllowed() {
		t.Fatalf("lobby update lost hints: %v", err)
	}
}
