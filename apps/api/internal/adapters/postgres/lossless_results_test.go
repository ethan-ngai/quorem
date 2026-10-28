package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestLosslessRunResultAndSafeDefault(t *testing.T) {
	s := testStore(t)
	s.losslessResults = false
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	sub, err := s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	output := execution.PublicCaseResult{Index: 0, Status: "wrong_answer", Stdout: "a\x00b", Stderr: "c\x00d", Actual: json.RawMessage(`{"nested":["a\u0000b"]}`), Expected: json.RawMessage(`"\u0000"`), Diagnostics: []execution.Diagnostic{{Message: "e\x00f"}}}
	completion := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.WrongAnswer, PublicCaseResults: []execution.PublicCaseResult{output}}
	if err = s.Complete(ctx, job, completion); err == nil {
		t.Fatal("default-off accepted JSONB NUL")
	}
	pending, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || pending.State != "running" {
		t.Fatal(pending, err)
	}
	s.losslessResults = true
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || len(got.PublicCases) != 1 {
		t.Fatal(got, err)
	}
	rawWant, _ := json.Marshal(output)
	rawGot, _ := json.Marshal(got.PublicCases[0])
	if string(rawWant) != string(rawGot) {
		t.Fatalf("output changed: %s != %s", rawGot, rawWant)
	}
	var summary []byte
	var hasPayload bool
	if err = s.Pool.QueryRow(ctx, `SELECT result,result_payload IS NOT NULL FROM submissions WHERE id=$1`, sub.ID).Scan(&summary, &hasPayload); err != nil || !hasPayload {
		t.Fatal(err)
	}
	if strings.Contains(string(summary), "stdout") || !strings.Contains(string(summary), "wrong_answer") {
		t.Fatalf("invalid query summary: %s", summary)
	}
	// Even a no-op legacy write invalidates the opaque payload.
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result=result WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT result_payload IS NULL FROM submissions WHERE id=$1`, sub.ID).Scan(&hasPayload); err != nil || !hasPayload {
		t.Fatal("no-op legacy write retained payload", err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result_payload='legacy'::bytea WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	// A legacy writer cannot leave an opaque payload shadowing its new JSONB result.
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result='{"publicCases":[{"index":0,"status":"accepted","stdout":"legacy"}]}' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.Submission(ctx, "alice", sub.ID)
	if err != nil || len(got.PublicCases) != 1 || got.PublicCases[0].Stdout != "legacy" {
		t.Fatalf("legacy overwrite: %+v %v", got, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result_payload='legacy'::bytea WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	// Old cleanup binaries still invoke the migration trigger for byte payloads.
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result=NULL WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT result_payload IS NULL FROM submissions WHERE id=$1`, sub.ID).Scan(&hasPayload); err != nil || !hasPayload {
		t.Fatal("payload retained", err)
	}
}

func TestLosslessInterviewPrivateResultsAndRetention(t *testing.T) {
	s := interviewTestStore(t)
	s.losslessResults = true
	ctx := context.Background()
	q := customInterviewQuestion()
	room, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Private results", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	sub, err := admitInterviewForTest(s, ctx, "bob", room.ID, ID(), "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	private := execution.PublicCaseResult{Index: 0, Status: "accepted", Stdout: "private\x00stdout", Stderr: "private\x00stderr", Actual: json.RawMessage(`"a\u0000b"`), Expected: json.RawMessage(`"\u0000"`), Diagnostics: []execution.Diagnostic{{Message: "private\x00diagnostic"}}}
	sample := execution.PublicCaseResult{Index: 0, Status: "accepted", Stdout: "sample\x00output"}
	c := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 1, Total: 1}, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}}, PrivateCaseResults: []execution.PublicCaseResult{private}, SubmitSampleResults: []execution.PublicCaseResult{sample}}
	if err = s.Complete(ctx, job, c); err != nil {
		t.Fatal(err)
	}
	staff, err := s.InterviewSubmission(ctx, "alice", room.ID, sub.ID)
	if err != nil || len(staff.PrivateCaseResults) != 1 || staff.PrivateCaseResults[0].Stdout != private.Stdout || staff.PrivateCaseResults[0].Stderr != private.Stderr || string(staff.PrivateCaseResults[0].Actual) != string(private.Actual) || string(staff.PrivateCaseResults[0].Expected) != string(private.Expected) || len(staff.PrivateCaseResults[0].Diagnostics) != 1 || staff.PrivateCaseResults[0].Diagnostics[0].Message != private.Diagnostics[0].Message {
		t.Fatal(staff, err)
	}
	candidate, err := s.InterviewSubmission(ctx, "bob", room.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 0 || len(candidate.PublicCases) != 1 || candidate.PublicCases[0].Stdout != sample.Stdout {
		t.Fatal(candidate, err)
	}
	if _, err = s.SetInterviewCaseVisibility(ctx, "alice", room.ID, ID(), "hidden:0", true); err != nil {
		t.Fatal(err)
	}
	candidate, err = s.InterviewSubmission(ctx, "bob", room.ID, sub.ID)
	if err != nil || len(candidate.PrivateCaseResults) != 1 || candidate.PrivateCaseResults[0].Stdout != private.Stdout {
		t.Fatal(candidate, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_execution SET private_results='[{"index":0,"status":"accepted","stdout":"legacy"}]' WHERE submission_id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	staff, err = s.InterviewSubmission(ctx, "alice", room.ID, sub.ID)
	if err != nil || len(staff.PrivateCaseResults) != 1 || staff.PrivateCaseResults[0].Stdout != "legacy" {
		t.Fatalf("legacy private overwrite: %+v %v", staff, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_execution SET private_results_payload='legacy'::bytea WHERE submission_id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET result=NULL WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	var cleared bool
	if err = s.Pool.QueryRow(ctx, `SELECT s.result_payload IS NULL AND e.private_results IS NULL AND e.private_results_payload IS NULL FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.id=$1`, sub.ID).Scan(&cleared); err != nil || !cleared {
		t.Fatal("legacy cleanup retained payload", cleared, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_execution SET private_results_payload='legacy'::bytea WHERE submission_id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(context.Background(), `UPDATE users SET kind='account' WHERE id='bob'`); err != nil {
			t.Error(err)
		}
	})
	if _, err = s.Pool.Exec(ctx, `UPDATE users SET kind='guest' WHERE id='bob'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET admitted_at=clock_timestamp()-interval '8 days' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT s.result IS NULL AND s.result_payload IS NULL AND e.private_results IS NULL AND e.private_results_payload IS NULL FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.id=$1`, sub.ID).Scan(&cleared); err != nil || !cleared {
		t.Fatal("retention", cleared, err)
	}
}
