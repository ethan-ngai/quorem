package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestCreateMatchWithPublicOdyssey(t *testing.T) {
	s := adminStore(t)
	s.losslessResults = true
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
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "alice", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "bob", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{"alice", "bob"} {
		workspace := matchWorkspace(t, s, created.ID, owner)
		for _, kind := range []string{"run", "submit"} {
			_, err = s.Admit(ctx, owner, ID(), judging.Command{WorkspaceID: workspace, Kind: kind, Source: "source", Level: 1}, ID())
			if err != nil {
				t.Fatal(owner, kind, err)
			}
			job := claimJobs(t, s, 1)[0]
			spec, err := s.LoadExecution(ctx, job)
			if err != nil {
				t.Fatal(err)
			}
			completion := execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}
			if kind == "submit" {
				completion.Score = &execution.Score{Passed: len(spec.Cases), Total: len(spec.Cases)}
				for i := range spec.Cases {
					completion.HiddenCases = append(completion.HiddenCases, execution.HiddenCaseResult{Index: i, Status: execution.Accepted})
				}
			}
			if err = s.Complete(ctx, job, completion); err != nil {
				t.Fatal(err)
			}
		}
		progress, err := s.Odyssey(ctx, owner, workspace)
		if err != nil || progress.Level != 2 {
			t.Fatalf("progress: %+v %v", progress, err)
		}
		match, err := s.Match(ctx, owner, created.ID)
		if err != nil || match.State != "active" {
			t.Fatalf("intermediate match: %+v %v", match, err)
		}
	}
	workspace := matchWorkspace(t, s, created.ID, "alice")
	execSQL(t, s, "UPDATE users SET admission_tokens=2 WHERE id='alice'")
	_, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace, Kind: "submit", Source: "source", Level: 2}, ID())
	if err != nil {
		t.Fatal(err)
	}
	job := claimJobs(t, s, 1)[0]
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed"}`)}); err != nil {
		t.Fatal(err)
	}
	if err = s.YieldExecution(ctx, job); err != nil {
		t.Fatal(err)
	}
	pending, err := s.Match(ctx, "alice", created.ID)
	if err != nil || pending.State != "active" || pending.Outcome != nil {
		t.Fatal("partial score resolved match", pending, err)
	}
	job, err = claimTestJob(ctx, s, true)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	completion := execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: len(spec.Cases), Total: len(spec.Cases)}}
	for i := range spec.Cases {
		completion.HiddenCases = append(completion.HiddenCases, execution.HiddenCaseResult{Index: i, Status: execution.Accepted})
	}
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	match, err := s.Match(ctx, "alice", created.ID)
	if err != nil || match.State != "completed" || match.Outcome == nil || match.Outcome.WinnerUserID != match.HostUserID {
		t.Fatalf("final match: %+v %v", match, err)
	}
}
