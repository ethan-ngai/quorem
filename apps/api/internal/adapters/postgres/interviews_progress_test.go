package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

func TestInterviewManualStagePass(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	grantInternal(t, s, "alice")
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Manual stages", Question: customStagedInterviewQuestion()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PassInterviewStage(ctx, "bob", v.ID, ID(), v.QuestionEpoch, 1); errorCode(err) != "forbidden" {
		t.Fatal("candidate passed stage", err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), ID(), 1); errorCode(err) != "document_changed" {
		t.Fatal("stale question passed", err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), v.QuestionEpoch, 2); errorCode(err) != "stale_version" {
		t.Fatal("future stage passed", err)
	}
	key := ID()
	next, err := s.PassInterviewStage(ctx, "alice", v.ID, key, v.QuestionEpoch, 1)
	if err != nil {
		t.Fatal(err)
	}
	if next.Question.Progress.Level != 2 || next.Question.Progress.Completed || next.Document != v.Document || next.QuestionEpoch != v.QuestionEpoch {
		t.Fatal("progress or document", next)
	}
	retry, err := s.PassInterviewStage(ctx, "alice", v.ID, key, v.QuestionEpoch, 1)
	if err != nil || retry.Version != next.Version || retry.Question.Progress.Completed {
		t.Fatal("retry advanced again", retry, err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), v.QuestionEpoch, 1); errorCode(err) != "stale_version" {
		t.Fatal("old stage passed again", err)
	}
	candidate, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || candidate.Question.Progress.Level != 2 || len(candidate.Question.Progress.Levels) != 2 || len(candidate.Question.PrivateCases) != 0 {
		t.Fatal("candidate unlock/privacy", candidate, err)
	}
	if _, err = s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	final, err := s.PassInterviewStage(ctx, "bob", v.ID, ID(), v.QuestionEpoch, 2)
	if err != nil || !final.Question.Progress.Completed || final.Question.Progress.Level != 2 || final.Document != v.Document {
		t.Fatal("co-interviewer final pass", final, err)
	}
	if _, err = s.PassInterviewStage(ctx, "bob", v.ID, ID(), v.QuestionEpoch, 2); errorCode(err) != "stale_version" {
		t.Fatal("completed stage passed", err)
	}
	if _, err = s.CloseInterview(ctx, "alice", v.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), v.QuestionEpoch, 2); errorCode(err) != "invalid_transition" {
		t.Fatal("closed pass", err)
	}
	classic := createInterviewTest(t, s)
	if _, err = s.PassInterviewStage(ctx, "alice", classic.ID, ID(), classic.QuestionEpoch, 1); errorCode(err) != "invalid_input" {
		t.Fatal("classic pass", err)
	}

}
