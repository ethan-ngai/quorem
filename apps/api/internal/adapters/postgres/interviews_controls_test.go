package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"os"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestInterviewLanguageSwitchPreservesSharedDraftsAndQuestionScope(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	if len(v.Question.Languages) != 4 {
		t.Fatal("custom languages", v.Question.Languages)
	}
	if _, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	insert, _ := json.Marshal([]any{[]any{0, "# shared python", ""}, len(v.Document.Source)})
	if _, err := s.PushInterviewUpdates(ctx, "bob", v.ID, ID(), interviews.Push{Epoch: v.Document.Epoch, Updates: []interviews.Update{{ClientID: "bob", Changes: insert}}}); err != nil {
		t.Fatal(err)
	}
	switched, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", v.Document.Epoch)
	if err != nil {
		t.Fatal(err)
	}
	if switched.Question.Language != "java" || switched.QuestionEpoch != v.QuestionEpoch || switched.Document.Epoch == v.Document.Epoch || !strings.Contains(switched.Document.Source, "class Solution") {
		t.Fatal("language switch", switched)
	}
	if _, err = s.PushInterviewUpdates(ctx, "alice", v.ID, ID(), interviews.Push{Epoch: v.Document.Epoch, Updates: []interviews.Update{{ClientID: "alice-old", Changes: json.RawMessage(`[0]`)}}}); errorCode(err) != "document_changed" {
		t.Fatal("old epoch admitted", err)
	}
	insert, _ = json.Marshal([]any{[]any{0, "// shared java", ""}, len(switched.Document.Source)})
	if _, err = s.PushInterviewUpdates(ctx, "bob", v.ID, ID(), interviews.Push{Epoch: switched.Document.Epoch, Updates: []interviews.Update{{ClientID: "bob-java", Changes: insert}}}); err != nil {
		t.Fatal(err)
	}
	restored, err := s.SwitchInterviewLanguage(ctx, "alice", v.ID, ID(), "python", switched.Document.Epoch)
	if err != nil || !strings.HasPrefix(restored.Document.Source, "# shared python\n") {
		t.Fatal("python draft lost", restored, err)
	}
	var activeDraft bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$2 AND language='python')`, v.ID, v.QuestionEpoch).Scan(&activeDraft); err != nil || activeDraft {
		t.Fatal("active document retained a duplicate draft", activeDraft, err)
	}
	again, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", restored.Document.Epoch)
	if err != nil || !strings.HasPrefix(again.Document.Source, "// shared java\n") {
		t.Fatal("java draft lost", again, err)
	}
	replacement, err := s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customInterviewQuestion())
	if err != nil {
		t.Fatal(err)
	}
	if replacement.QuestionEpoch == again.QuestionEpoch {
		t.Fatal("question scope reused")
	}
	fresh, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", replacement.Document.Epoch)
	if err != nil || strings.Contains(fresh.Document.Source, "shared java") {
		t.Fatal("new question inherited old draft", fresh, err)
	}
}
func TestInterviewRoleInvitesDeriveMembershipFromSecretToken(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	if v.Invites == nil || v.Invites.Interviewer == v.Invites.Interviewee {
		t.Fatal("role tokens missing")
	}
	ee := strings.TrimPrefix(v.Invites.Interviewee, "/interview-invite/")
	interviewer := strings.TrimPrefix(v.Invites.Interviewer, "/interview-invite/")
	for token, role := range map[string]string{ee: "interviewee", interviewer: "interviewer"} {
		preview, err := s.PreviewInterviewInvite(ctx, token)
		if err != nil || preview.Role != role || preview.SessionID != v.ID {
			t.Fatal("role preview", preview, err)
		}
	}
	joined, err := s.JoinInterview(ctx, "bob", ee, "", "")
	if err != nil || joined.Role != "interviewee" || joined.Invites != nil {
		t.Fatal("candidate role", joined, err)
	}
	joined, err = s.JoinInterview(ctx, "bob", interviewer, "", "")
	if err != nil || joined.Role != "interviewer" || joined.Invites == nil {
		t.Fatal("interviewer role", joined, err)
	}
	joined, err = s.JoinInterview(ctx, "bob", ee, "", "")
	if err != nil || joined.Role != "interviewer" {
		t.Fatal("less privileged token demoted member", joined, err)
	}
	credential := guestCredential()
	guest, err := s.JoinInterview(ctx, "", interviewer, credential, "Guest interviewer")
	if err != nil || guest.Role != "interviewer" {
		t.Fatal("guest interviewer role", guest, err)
	}
	rotate, err := s.RotateInterviewGuestCredential(ctx, credential, ee)
	if err != nil || rotate {
		t.Fatal("role token changed guest scope", rotate, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='alice'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PreviewInterviewInvite(ctx, interviewer); errorCode(err) != "not_found" {
		t.Fatal("revoked host invite preview", err)
	}
	if _, err = s.JoinInterview(ctx, "charlie", interviewer, "", ""); errorCode(err) != "entitlement_required" {
		t.Fatal("revoked host invite admission", err)
	}
}
func TestInterviewPrivateCaseDetailsRevealHideAndResultRedaction(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	q := customInterviewQuestion()
	q.Custom.PrivateCases = append(q.Custom.PrivateCases, q.Custom.PrivateCases[0])
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Private test details", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	if len(v.Question.PrivateCaseDetails) != 2 || len(v.Question.RevealedCases) != 0 {
		t.Fatal("interviewer case catalog", v.Question)
	}
	key := ID()
	sub, err := admitInterviewForTest(s, ctx, "bob", v.ID, key, "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatal("claim", job, err)
	}
	pending, err := s.InterviewSubmission(ctx, "alice", v.ID, sub.ID)
	if err != nil || len(pending.PrivateCaseResults) != 0 {
		t.Fatal("pending fabricated private result", pending, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || !spec.PrivateDetails || len(spec.SubmitSamples) != 1 {
		t.Fatal("private result capture flag", spec, err)
	}
	raw := []execution.PublicCaseResult{{Index: 0, Status: "wrong_answer", Actual: json.RawMessage(`7`), Expected: json.RawMessage(`987655`), Stdout: "private stdout zero", Stderr: "private stderr zero"}, {Index: 1, Status: "accepted", Actual: json.RawMessage(`987655`), Expected: json.RawMessage(`987655`), Stdout: "private stdout one"}}
	completion := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.WrongAnswer, Score: &execution.Score{Passed: 1, Total: 2}, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.WrongAnswer}, {Index: 1, Status: execution.Accepted}}, PrivateCaseResults: raw, SubmitSampleResults: []execution.PublicCaseResult{{Index: 0, Status: "accepted", Actual: json.RawMessage(`2`), Expected: json.RawMessage(`2`), Stdout: "sample stdout"}}}
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	ownerResult, err := s.Submission(ctx, "bob", sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(ownerResult)
	if strings.Contains(string(data), "private stdout") || len(ownerResult.PrivateCaseResults) != 0 || len(ownerResult.HiddenCases) != 0 {
		t.Fatal("generic submission private leak", string(data))
	}
	replay, err := admitInterviewForTest(s, ctx, "bob", v.ID, key, "submit", nil)
	if err != nil || replay.State != "completed" || len(replay.HiddenCases) != 0 || len(replay.PrivateCaseResults) != 0 {
		t.Fatal("admission replay exposed private results", replay, err)
	}
	staff, err := s.InterviewSubmission(ctx, "alice", v.ID, sub.ID)
	if err != nil || len(staff.PrivateCaseResults) != 2 || len(staff.HiddenCases) != 2 || staff.PrivateCaseResults[0].Stdout != "private stdout zero" || staff.PrivateCaseResults[1].CaseID != "hidden:1" {
		t.Fatal("interviewer result details", staff, err)
	}
	candidate, err := s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 0 || len(candidate.HiddenCases) != 0 || len(candidate.PublicCases) != 1 || candidate.PublicCases[0].Stdout != "sample stdout" {
		t.Fatal("unrevealed result leak", candidate, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "bob", v.ID, ID(), "hidden:0", true); errorCode(err) != "forbidden" {
		t.Fatal("candidate revealed private case", err)
	}
	revealed, err := s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "hidden:0", true)
	if err != nil || len(revealed.Question.RevealedCases) != 1 {
		t.Fatal("reveal", revealed, err)
	}
	snap, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(snap.Question.PrivateCaseDetails) != 0 || len(snap.Question.RevealedCases) != 1 || snap.Question.RevealedCases[0].ID != "hidden:0" {
		t.Fatal("candidate reveal projection", snap, err)
	}
	candidate, err = s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 1 || candidate.PrivateCaseResults[0].Stdout != "private stdout zero" {
		t.Fatal("individual result reveal", candidate, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "hidden:0", false); err != nil {
		t.Fatal(err)
	}
	candidate, err = s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 0 {
		t.Fatal("hidden result remained exposed", candidate, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "hidden:0", true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_execution SET private_results=NULL WHERE submission_id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	ownerResult, err = s.Submission(ctx, "bob", sub.ID)
	if err != nil || len(ownerResult.HiddenCases) != 0 {
		t.Fatal("generic legacy results exposed private verdicts", ownerResult, err)
	}
	legacy, err := s.InterviewSubmission(ctx, "alice", v.ID, sub.ID)
	if err != nil || len(legacy.PrivateCaseResults) != 2 || legacy.PrivateCaseResults[0].Status != "wrong_answer" || legacy.PrivateCaseResults[0].Stdout != "" {
		t.Fatal("legacy result status fallback", legacy, err)
	}
	legacyCandidate, err := s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(legacyCandidate.HiddenCases) != 0 || len(legacyCandidate.PrivateCaseResults) != 1 || legacyCandidate.PrivateCaseResults[0].Status != "wrong_answer" {
		t.Fatal("legacy revealed result", legacyCandidate, err)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), q); err != nil {
		t.Fatal(err)
	}
	candidate, err = s.InterviewSubmission(ctx, "bob", v.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 0 {
		t.Fatal("old question reveal leaked after replacement", candidate, err)
	}
}

func TestInterviewLanguageSwitchRetainsOdysseyProgressAndExplicitFutureVisibility(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	grantInternal(t, s, "alice")
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET role='admin' WHERE id='alice'`); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var content problems.QuestionContent
	if err = json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	d, err := s.CreateQuestionDraft(ctx, "alice", content)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Shared language Odyssey", Question: interviews.QuestionInput{Language: "python", ProblemVersionID: d.PublishedVersionID}})
	if err != nil {
		t.Fatal(err)
	}
	if v.Question.Progress.TotalLevels != 2 || len(v.Question.Progress.Levels) != 1 {
		t.Fatal("total/locked levels", v.Question.Progress)
	}
	if len(v.Question.PrivateCaseDetails) != 4 {
		t.Fatal("interviewer cannot see all stages tests", v.Question)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	before, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(before.Question.RevealedCases) != 0 {
		t.Fatal("implicit future case leak", before, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "bob", v.ID, ID(), "level:2:case:0", true, v.QuestionEpoch); errorCode(err) != "forbidden" {
		t.Fatal("candidate self-revealed future case", err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "level:2:case:0", true, v.QuestionEpoch); err != nil {
		t.Fatal("staff explicit future reveal", err)
	}
	exposed, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(exposed.Question.RevealedCases) != 1 || exposed.Question.RevealedCases[0].ID != "level:2:case:0" || exposed.Question.Progress.Level != 1 || len(exposed.Question.Progress.Levels) != 1 {
		t.Fatal("explicit reveal unlocked stage or exposed other cases", exposed, err)
	}
	sub, err := admitInterviewForTest(s, ctx, "bob", v.ID, ID(), "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatal(job, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || len(spec.Cases) != 2 {
		t.Fatal("revealing future case changed admitted stage suite", len(spec.Cases), err)
	}
	finishInterviewJob(t, s, job, 2, 2)
	switched, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", v.Document.Epoch)
	if err != nil || switched.Question.Progress.Level != 2 || switched.Question.Progress.TotalLevels != 2 || switched.QuestionEpoch != v.QuestionEpoch {
		t.Fatal("language reset progress", switched, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "level:2:case:0", true, v.QuestionEpoch); err != nil {
		t.Fatal("unlocked case unavailable", err)
	}
	restored, err := s.SwitchInterviewLanguage(ctx, "alice", v.ID, ID(), "python", switched.Document.Epoch)
	if err != nil || restored.Question.Progress.Level != 2 || len(restored.Question.RevealedCases) != 1 {
		t.Fatal("restored language reset progress/reveal", restored, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", v.ID, ID(), "level:1:case:0", true, ID()); errorCode(err) != "document_changed" {
		t.Fatal("stale question reveal admitted", err)
	}
}
