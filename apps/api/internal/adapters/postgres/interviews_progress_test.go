package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/internal/execution"
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
	if len(next.Question.Progress.CaseStatuses) != 0 {
		t.Fatal("manual pass fabricated public verdicts", next)
	}
	for _, test := range next.Question.PrivateCaseDetails {
		if test.Status != "" {
			t.Fatal("manual pass fabricated private verdict", test)
		}
	}
	retry, err := s.PassInterviewStage(ctx, "alice", v.ID, key, v.QuestionEpoch, 1)
	if err != nil || retry.Version != next.Version || retry.Question.Progress.Completed {
		t.Fatal("retry advanced again", retry, err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), v.QuestionEpoch, 1); errorCode(err) != "stale_version" {
		t.Fatal("old stage passed again", err)
	}
	candidate, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || candidate.Question.Progress.Level != 2 || len(candidate.Question.Progress.Levels) != 2 || len(candidate.Question.PrivateCaseDetails) != 0 {
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

func TestInterviewRetainsEvaluatedFeedbackAcrossAdvanceAndPending(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	grantInternal(t, s, "alice")
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Evaluated stages", Question: customStagedInterviewQuestion()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	sub, err := admitInterviewForTest(s, ctx, "alice", v.ID, ID(), "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatal(job, err)
	}
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed"}`)}); err != nil {
		t.Fatal(err)
	}
	if err = s.YieldExecution(ctx, job); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PassInterviewStage(ctx, "alice", v.ID, ID(), v.QuestionEpoch, 1); err != nil {
		t.Fatal(err)
	}
	job, err = s.ClaimResumable(ctx)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	if len(spec.Problem.Odyssey.Levels) != 1 || len(spec.SubmitSamples) != 1 {
		t.Fatalf("future stage included in execution: %+v", spec.Problem.Odyssey)
	}
	private := []execution.PublicCaseResult{{Index: 0, Status: "accepted"}}
	completion := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: len(spec.Cases), Total: len(spec.Cases)}, PrivateCaseResults: private}
	for index := range spec.Cases {
		completion.HiddenCases = append(completion.HiddenCases, execution.HiddenCaseResult{Index: index, Status: execution.Accepted})
	}
	for index := range spec.SubmitSamples {
		completion.SubmitSampleResults = append(completion.SubmitSampleResults, execution.PublicCaseResult{Index: index, Status: "accepted"})
	}
	extra := completion
	extra.SubmitSampleResults = append(append([]execution.PublicCaseResult{}, completion.SubmitSampleResults...), execution.PublicCaseResult{Index: 1, Status: "accepted"})
	if err = s.Complete(ctx, job, extra); err == nil {
		t.Fatal("accepted future-stage sample")
	}
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	result, err := s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(result.PublicCases) != 1 {
		t.Fatalf("future samples exposed: %+v %v", result.PublicCases, err)
	}
	advanced, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || advanced.Question.Progress.Level != 2 || len(advanced.Question.Progress.CaseStatuses) != 1 || advanced.Question.Progress.CaseStatuses[0].Status != "accepted" {
		t.Fatal(advanced, err)
	}
	if advanced.Question.PrivateCaseDetails[0].Status != "accepted" || advanced.Question.PrivateCaseDetails[1].Status != "" {
		t.Fatal("private prefix", advanced.Question.PrivateCaseDetails)
	}
	if _, err = admitInterviewForTest(s, ctx, "bob", v.ID, ID(), "run", nil); err != nil {
		t.Fatal(err)
	}
	pending, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(pending.Question.Progress.CaseStatuses) != 1 || pending.Question.Progress.CaseStatuses[0].Status != "accepted" || len(pending.Question.RevealedCases) != 0 || len(pending.Question.PrivateCaseDetails) != 0 {
		t.Fatal("pending feedback/privacy", pending, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "level:1:case:0", true, v.QuestionEpoch); err != nil {
		t.Fatal(err)
	}
	revealed, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(revealed.Question.RevealedCases) != 1 || revealed.Question.RevealedCases[0].Status != "accepted" {
		t.Fatal("revealed verdict", revealed, err)
	}

	runJob, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Complete(ctx, runJob, execution.Completion{SubmissionID: runJob.SubmissionID, AttemptID: runJob.AttemptID, Verdict: execution.WrongAnswer, PublicCaseResults: []execution.PublicCaseResult{{Index: 0, Status: "wrong_answer"}, {Index: 1, Status: "accepted"}}}); err != nil {
		t.Fatal(err)
	}
	regression, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || len(regression.Question.Progress.CaseStatuses) != 2 || regression.Question.Progress.CaseStatuses[0].Status != "wrong_answer" || regression.Question.Progress.CaseStatuses[1].Status != "accepted" {
		t.Fatal("new evaluation did not replace historical status", regression, err)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customStagedInterviewQuestion()); err != nil {
		t.Fatal(err)
	}
	replaced, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || len(replaced.Question.Progress.CaseStatuses) != 0 || replaced.Question.PrivateCaseDetails[0].Status != "" {
		t.Fatal("old question feedback leaked", replaced, err)
	}
}
