package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func interviewTestStore(t *testing.T) *Store {
	t.Helper()
	s := testStore(t)
	if _, err := s.Pool.Exec(context.Background(), `TRUNCATE interviews CASCADE; INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'alice','interviews.host','manual','test','test','test'),(gen_random_uuid(),'alice','questions.custom','manual','test','test','test')`); err != nil {
		t.Fatal(err)
	}
	return s
}
func customInterviewQuestion() interviews.QuestionInput {
	return interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Private increment", StatementMarkdown: "Return n plus one.", Signature: problems.Signature{ClassName: "Solution", MethodName: "increment", Parameters: []problems.Parameter{{Name: "n", Type: "int"}}, ReturnType: "int"}, StarterSource: "class Solution:\n    def increment(self, n):\n        return n + 1\n", PublicCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}}, PrivateCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`987654`)}, Expected: json.RawMessage(`987655`)}}}}
}
func createInterviewTest(t *testing.T, s *Store) interviews.Snapshot {
	t.Helper()
	v, err := s.CreateInterview(context.Background(), "alice", ID(), interviews.Create{Title: "Test interview", Question: customInterviewQuestion()})
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func TestInterviewRolesPrivacyDurabilityAndGuestRevocation(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	q := customInterviewQuestion()
	if _, err := s.CreateInterview(ctx, "bob", ID(), interviews.Create{Title: "Denied", Question: q}); errorCode(err) != "entitlement_required" {
		t.Fatalf("ungated host %v", err)
	}
	v := createInterviewTest(t, s)
	token := strings.TrimPrefix(v.InvitePath, "/interview-invite/")
	preview, err := s.PreviewInterviewInvite(ctx, token)
	if err != nil || preview.SessionID != v.ID || preview.Title != v.Title || preview.State != "active" {
		t.Fatalf("guest invitation preview: %+v %v", preview, err)
	}
	if _, err := s.Interview(ctx, "bob", v.ID); errorCode(err) != "not_found" {
		t.Fatalf("nonmember read %v", err)
	}
	member, err := s.JoinInterview(ctx, "bob", token, "", "")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(member)
	if strings.Contains(string(data), "987654") || strings.Contains(string(data), "987655") || member.InvitePath != "" {
		t.Fatalf("private test leak %s", data)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "bob", v.ID, ID(), q); errorCode(err) != "forbidden" {
		t.Fatalf("interviewee modified question: %v", err)
	}
	if _, err = s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	member, err = s.Interview(ctx, "bob", v.ID)
	if err != nil || len(member.Question.PrivateCases) != 1 {
		t.Fatal("interviewer visibility", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	guest, err := s.JoinInterview(ctx, "", token, credential, "Candidate")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := s.InterviewGuestIdentity(ctx, credential)
	if err != nil || !principal.Guest {
		t.Fatal("guest credential", err)
	}
	if _, err = s.GuestIdentity(ctx, credential); err == nil {
		t.Fatal("interview cookie authorized match guest")
	}
	// A second Store represents another API replica; persisted source/membership survive process boundaries.
	replica := &Store{Pool: s.Pool, inviteKey: s.inviteKey}
	if _, err = replica.Interview(ctx, principal.UserID, guest.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RemoveInterviewMember(ctx, "alice", v.ID, ID(), principal.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err = replica.InterviewGuestIdentity(ctx, credential); err == nil {
		t.Fatal("revoked guest authorized")
	}
	if _, err = replica.Interview(ctx, principal.UserID, v.ID); errorCode(err) != "not_found" {
		t.Fatal("removed member read", err)
	}
	if _, err = s.CloseInterview(ctx, "alice", v.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.PushInterviewUpdates(ctx, "bob", v.ID, ID(), interviews.Push{Epoch: v.Document.Epoch, Updates: []interviews.Update{{ClientID: "x", Changes: json.RawMessage(`[0]`)}}}); errorCode(err) != "invalid_transition" {
		t.Fatal("closed write", err)
	}
}
func TestInterviewOrderedChangesStaleRetryAndIsolation(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	token := strings.TrimPrefix(v.InvitePath, "/interview-invite/")
	if _, err := s.JoinInterview(ctx, "bob", token, "", ""); err != nil {
		t.Fatal(err)
	}
	length := len(v.Document.Source)
	changes, _ := json.Marshal([]any{[]any{0, "# 😀"}, length})
	p := interviews.Push{Epoch: v.Document.Epoch, Updates: []interviews.Update{{ClientID: "alice-tab", Changes: changes}}}
	key := ID()
	first, err := s.PushInterviewUpdates(ctx, "alice", v.ID, key, p)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.PushInterviewUpdates(ctx, "alice", v.ID, key, p)
	if err != nil || retry.Version != first.Version {
		t.Fatal("retry duplicated", err)
	}
	if _, err = s.PushInterviewUpdates(ctx, "bob", v.ID, ID(), p); errorCode(err) != "stale_version" {
		t.Fatal("stale write admitted", err)
	}
	updates, err := s.InterviewUpdates(ctx, "bob", v.ID, v.Document.Epoch, 0)
	if err != nil || len(updates.Updates) != 1 || updates.Version != 1 {
		t.Fatal("ordered recovery", updates, err)
	}
	p.Version = 1
	p.Updates = []interviews.Update{{ClientID: "bob-tab", Changes: json.RawMessage(`[4,[0,"!"],` + jsonNumber(length) + `]`)}}
	if _, err = s.PushInterviewUpdates(ctx, "bob", v.ID, ID(), p); err != nil {
		t.Fatal(err)
	}
	doc, err := s.InterviewDocument(ctx, "alice", v.ID)
	if err != nil || !strings.HasPrefix(doc.Source, "# 😀!") || doc.Version != 2 {
		t.Fatal("UTF16 edit", doc, err)
	}
	if _, err = s.PushInterviewUpdates(ctx, "alice", v.ID, key, p); errorCode(err) != "idempotency_conflict" {
		t.Fatal("key conflict", err)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customInterviewQuestion()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.InterviewUpdates(ctx, "alice", v.ID, v.Document.Epoch, 2); errorCode(err) != "document_changed" {
		t.Fatal("old epoch read", err)
	}
	var catalog int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM problems WHERE slug='interview-private'`).Scan(&catalog); err != nil || catalog != 0 {
		t.Fatal("private question published", catalog, err)
	}
}
func jsonNumber(v int) string { data, _ := json.Marshal(v); return string(data) }
func TestInterviewAdmissionSnapshotsSourceAndSharedResults(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	if _, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	sub, err := s.AdmitInterview(ctx, "bob", v.ID, ID(), "submit")
	if err != nil {
		t.Fatal(err)
	}
	var source string
	var fixture, cases []byte
	if err = s.Pool.QueryRow(ctx, `SELECT s.source,e.fixture,s.cases FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.id=$1`, sub.ID).Scan(&source, &fixture, &cases); err != nil {
		t.Fatal(err)
	}
	if source != v.Document.Source || !strings.Contains(string(fixture), "987654") || !strings.Contains(string(cases), "987654") {
		t.Fatal("admission snapshot differs")
	}
	shared, err := s.InterviewSubmission(ctx, "alice", v.ID, sub.ID)
	if err != nil || shared.ID != sub.ID {
		t.Fatal("shared result", err)
	}
	snapshot, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || snapshot.LatestSubmissionID != sub.ID {
		t.Fatal("latest shared execution", err)
	}
	if _, err = s.AdmitInterview(ctx, "bob", v.ID, ID(), "run"); errorCode(err) != "user_busy" {
		t.Fatal("busy bypass", err)
	}
}

func TestInterviewPresenceAuthorizationAndExpiry(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	p := interviews.PresenceInput{ClientID: "alice-tab", Epoch: v.Document.Epoch, Version: 0, Anchor: 0, Head: 2}
	people, err := s.UpdateInterviewPresence(ctx, "alice", v.ID, p)
	if err != nil || len(people) != 1 || people[0].UserID != "alice" {
		t.Fatal("presence publish", people, err)
	}
	if _, err = s.InterviewPresence(ctx, "bob", v.ID); errorCode(err) != "not_found" {
		t.Fatal("nonmember presence read", err)
	}
	p.Version = 1
	if _, err = s.UpdateInterviewPresence(ctx, "alice", v.ID, p); errorCode(err) != "stale_version" {
		t.Fatal("stale cursor admitted", err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_presence SET updated_at=clock_timestamp()-interval '21 seconds'`); err != nil {
		t.Fatal(err)
	}
	people, err = s.InterviewPresence(ctx, "alice", v.ID)
	if err != nil || len(people) != 0 {
		t.Fatal("expired presence retained", people, err)
	}
}

func TestInterviewOdysseySharesProgressAndProtectsReplacementEpoch(t *testing.T) {
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
	draft, err := s.CreateQuestionDraft(ctx, "alice", content)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = s.PublishQuestionDraft(ctx, "alice", draft.ID, draft.Revision)
	if err != nil {
		t.Fatal(err)
	}
	q := interviews.QuestionInput{ProblemVersionID: draft.PublishedVersionID, Language: "python"}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'bob','interviews.host','manual','test','test','test')`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateInterview(ctx, "bob", ID(), interviews.Create{Title: "Flag isolation", Question: q}); errorCode(err) != "entitlement_required" {
		t.Fatal("Odyssey flag bypass", err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'bob','problems.odyssey','manual','test','test','test')`); err != nil {
		t.Fatal(err)
	}
	gated, err := s.CreateInterview(ctx, "bob", ID(), interviews.Create{Title: "Flag isolation", Question: q})
	if err != nil {
		t.Fatal("host Odyssey grant", err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='bob' AND feature='problems.odyssey'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AdmitInterview(ctx, "bob", gated.ID, ID(), "run"); errorCode(err) != "entitlement_required" {
		t.Fatal("revoked Odyssey admission", err)
	}

	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Odyssey interview", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	first, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || first.Question.Progress.Level != 1 || len(first.Question.Progress.Levels) != 1 {
		t.Fatal("initial progress", first, err)
	}
	submit := func(passed, total int, finish bool) execution.Job {
		t.Helper()
		if _, err = s.Pool.Exec(ctx, `UPDATE users SET admission_tokens=2 WHERE id='bob'`); err != nil {
			t.Fatal(err)
		}
		sub, e := s.AdmitInterview(ctx, "bob", v.ID, ID(), "submit")
		if e != nil {
			t.Fatal(e)
		}
		job, e := s.Claim(ctx)
		if e != nil || job.SubmissionID != sub.ID {
			t.Fatal("claim", job, e)
		}
		spec, e := s.LoadExecution(ctx, job)
		if e != nil || len(spec.Cases) != total {
			t.Fatal("cumulative snapshot", len(spec.Cases), e)
		}
		if finish {
			finishInterviewJob(t, s, job, passed, total)
		}
		return job
	}
	submit(2, 2, true)
	next, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || next.Question.Progress.Level != 2 || len(next.Question.Progress.Levels) != 2 || next.Document.Source != v.Document.Source {
		t.Fatal("shared unlock/source retained", next, err)
	}
	submit(2, 4, true)
	next, err = s.Interview(ctx, "bob", v.ID)
	if err != nil || next.Question.Progress.Completed {
		t.Fatal("regression marked complete", err)
	}
	old := submit(4, 4, false)
	replacement, err := s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), q)
	if err != nil {
		t.Fatal(err)
	}
	finishInterviewJob(t, s, old, 4, 4)
	current, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || current.Question.Progress.Level != 1 || current.Question.Progress.Completed || current.Document.Epoch != replacement.Document.Epoch || current.LatestSubmissionID != "" {
		t.Fatal("old acceptance advanced replacement", current, err)
	}
}
func finishInterviewJob(t *testing.T, s *Store, job execution.Job, passed, total int) {
	t.Helper()
	statuses := []execution.HiddenCaseResult{}
	for i := 0; i < total; i++ {
		status := execution.WrongAnswer
		if i < passed {
			status = execution.Accepted
		}
		statuses = append(statuses, execution.HiddenCaseResult{Index: i, Status: status})
	}
	verdict := execution.WrongAnswer
	if passed == total {
		verdict = execution.Accepted
	}
	if err := s.Complete(context.Background(), job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: verdict, Score: &execution.Score{Passed: passed, Total: total}, HiddenCases: statuses}); err != nil {
		t.Fatal(err)
	}
}
func TestInterviewAndMatchGuestsShareSponsorConcurrency(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	token := strings.TrimPrefix(v.InvitePath, "/interview-invite/")
	for _, name := range []string{"One", "Two"} {
		credential := guestCredential()
		if _, err := s.JoinInterview(ctx, "", token, credential, name); err != nil {
			t.Fatal(err)
		}
		p, err := s.InterviewGuestIdentity(ctx, credential)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.AdmitInterview(ctx, p.UserID, v.ID, ID(), "run"); err != nil {
			t.Fatal(err)
		}
	}
	room := guestRoom(t, s, matches.FreeForAll)
	credential := guestCredential()
	if _, err := s.JoinGuest(ctx, inviteToken(t, room), credential, "Match guest"); err != nil {
		t.Fatal(err)
	}
	p, err := s.GuestIdentity(ctx, credential)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = guestAdmission(ctx, tx, p.UserID, room.ID); errorCode(err) != "rate_limited" {
		t.Fatal("match bypassed interview concurrency", err)
	}
}
