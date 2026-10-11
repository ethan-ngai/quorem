package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"sync"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL enables disposable PostgreSQL integration")
	}
	ctx := context.Background()
	store, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Pool.Close)
	if err = store.Migrate(ctx, "../../../migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(ctx, "TRUNCATE match_idempotency,match_outbox,match_reservations,match_participants,matches,cancellation_idempotency,outbox_events,execution_idempotency,execution_jobs,submissions,draft_sessions,draft_versions,workspaces,problem_versions CASCADE; UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp()"); err != nil {
		t.Fatal(err)
	}
	f, err := problems.LoadFixtures("../../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Seed(ctx, f); err != nil {
		t.Fatal(err)
	}
	return store
}
func errorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}
func TestDraftConcurrencyHistoryAndOwner(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	reused, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil || reused.ID != w.ID {
		t.Fatal("workspace reuse", err)
	}
	if _, err = store.Workspace(ctx, "bob", w.ID); errorCode(err) != "not_found" {
		t.Fatal("owner isolation", err)
	}
	session := ID()
	if _, err = store.Save(ctx, "alice", w.ID, "new", session, "2", nil); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Save(ctx, "alice", w.ID, "stale", session, "1", nil); errorCode(err) != "stale_session_save" {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := store.Save(ctx, "alice", w.ID, "tab", ID(), "1", nil); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	history, err := store.History(ctx, "alice", w.ID, 1000, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Items) != 4 || history.Items[0].Revision != "9" || history.NextCursor != "6" {
		t.Fatal(history)
	}
	rev := int64(1)
	restored, err := store.Save(ctx, "alice", w.ID, "", "", "", &rev)
	if err != nil || restored.Revision != "10" || restored.Source != "new" {
		t.Fatal(restored, err)
	}
	history, err = store.History(ctx, "alice", w.ID, 1000, 100)
	if err != nil || len(history.Items) != 10 {
		t.Fatal(history, err)
	}
}
func TestAdmissionRetryBusyCancellationAndFences(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	p, _ := store.Problem(ctx, "run-widths", false)
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "source"}
	first, err := store.Admit(ctx, "alice", "same", cmd, "a")
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.Admit(ctx, "alice", "same", cmd, "a")
	if err != nil || again.ID != first.ID {
		t.Fatal("retry before busy", err)
	}
	if _, err = store.Admit(ctx, "alice", "same", cmd, "b"); errorCode(err) != "idempotency_conflict" {
		t.Fatal(err)
	}
	if _, err = store.Admit(ctx, "alice", "other", cmd, "c"); errorCode(err) != "user_busy" {
		t.Fatal(err)
	}
	job, err := store.Claim(ctx)
	if err != nil || job.SubmissionID != first.ID {
		t.Fatal(job, err)
	}
	if _, err = store.Cancel(ctx, "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Admit(ctx, "alice", "still-busy", cmd, "d"); errorCode(err) != "user_busy" {
		t.Fatal("slot released before teardown", err)
	}
	if err = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 20, Total: 20}}); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Submission(ctx, "alice", first.ID)
	if got.State != "cancelled" || got.Score != nil {
		t.Fatal(got)
	}
	second, err := store.Admit(ctx, "alice", "second", cmd, "e")
	if err != nil {
		t.Fatal(err)
	}
	old, err := store.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", old.JobID); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.Claim(ctx)
	if err != nil || fresh.AttemptID == old.AttemptID {
		t.Fatal(fresh, err)
	}
	completion := execution.Completion{SubmissionID: old.SubmissionID, AttemptID: old.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 20, Total: 20}}
	if err = store.Complete(ctx, old, completion); err != nil {
		t.Fatal(err)
	}
	got, _ = store.Submission(ctx, "alice", second.ID)
	if got.State != "running" {
		t.Fatal("old completion overwrote", got)
	}
	completion.AttemptID = fresh.AttemptID
	completion.Score.Passed = 7
	completion.Verdict = execution.WrongAnswer
	completion.SafeDiagnostics = []execution.Diagnostic{{Message: "secret"}}
	completion.PublicCaseResults = []execution.PublicCaseResult{{Status: "secret"}}
	if err = store.Complete(ctx, fresh, completion); err != nil {
		t.Fatal(err)
	}
	got, _ = store.Submission(ctx, "alice", second.ID)
	if got.State != "completed" || got.Score.Passed != 7 || len(got.Diagnostics) != 0 || len(got.PublicCases) != 0 {
		t.Fatal("completion redaction", got)
	}
	if _, err = store.Admit(ctx, "alice", "quota", cmd, "f"); errorCode(err) != "quota_exceeded" {
		t.Fatal(err)
	}
}
func TestConcurrentAdmissionAndInfrastructureRetry(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	p, _ := store.Problem(ctx, "run-widths", false)
	w, _ := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "source"}
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.Admit(ctx, "alice", ID(), cmd, ID())
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				accepted++
			} else if errorCode(err) != "user_busy" {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatal(accepted)
	}
	for attempt := 0; attempt < 3; attempt++ {
		job, err := store.Claim(ctx)
		if err != nil || job.JobID == "" {
			t.Fatal(job, err)
		}
		if err = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "secret internal failure"}); err != nil {
			t.Fatal(err)
		}
		if attempt < 2 {
			store.Pool.Exec(ctx, "UPDATE execution_jobs SET available_at=clock_timestamp()")
		}
		if attempt == 2 {
			got, _ := store.Submission(ctx, "alice", job.SubmissionID)
			if got.State != "failed" || got.Verdict != "" || got.Score != nil || got.InfrastructureError != "Judge unavailable" {
				t.Fatal(got)
			}
		}
	}
}
func TestCancellationIdempotencyAndExpiredCrashBudget(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	p, _ := store.Problem(ctx, "run-widths", false)
	w, _ := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "snapshot"}
	v, err := store.Admit(ctx, "alice", "a", cmd, "a")
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CancelWithKey(ctx, "alice", v.ID, "cancel")
	if err != nil || first.State != "cancelled" {
		t.Fatal(first, err)
	}
	repeat, err := store.CancelWithKey(ctx, "alice", v.ID, "cancel")
	if err != nil || repeat.ID != first.ID || repeat.State != first.State {
		t.Fatal(repeat, err)
	}
	next, err := store.Admit(ctx, "alice", "b", cmd, "b")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.CancelWithKey(ctx, "alice", next.ID, "cancel"); errorCode(err) != "idempotency_conflict" {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		job, e := store.Claim(ctx)
		if e != nil || job.JobID == "" {
			t.Fatal(job, e)
		}
		if _, e = store.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", job.JobID); e != nil {
			t.Fatal(e)
		}
	}
	job, err := store.Claim(ctx)
	if err != nil || job.JobID != "" {
		t.Fatal(job, err)
	}
	got, _ := store.Submission(ctx, "alice", next.ID)
	if got.State != "failed" || got.Score != nil {
		t.Fatal(got)
	}
}
func TestGlobalBackpressureAndCustomValidation(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	p, _ := store.Problem(ctx, "run-widths", false)
	w, _ := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source", CustomCases: []problems.Case{{Args: nil}}}
	if _, err := store.Admit(ctx, "alice", "malformed", cmd, "m"); errorCode(err) != "invalid_input" {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		user := ID()
		workspaceID, submissionID, jobID := ID(), ID(), ID()
		_, err := store.Pool.Exec(ctx, `WITH u AS (INSERT INTO users(id,display_name) VALUES($1,'Load')), w AS (INSERT INTO workspaces(id,owner_id,problem_version_id,language,source) VALUES($2,$1,$3,'python','')), s AS (INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($4,$1,$2,'run','','hash','queued','[]')) INSERT INTO execution_jobs(id,submission_id) VALUES($5,$4)`, user, workspaceID, p.ID, submissionID, jobID)
		if err != nil {
			t.Fatal(err)
		}
	}
	cmd.CustomCases = nil
	if _, err := store.Admit(ctx, "alice", "pressure", cmd, "p"); errorCode(err) != "queue_saturated" {
		t.Fatal(err)
	}
}

func TestTypedCustomCasesRejectBeforeEnqueue(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	for _, test := range []struct{ slug, args, expected string }{
		{"run-widths", `[]`, ""},
		{"run-widths", `[[true]]`, ""},
		{"run-widths", `[[2147483648]]`, ""},
		{"run-widths", `[[1.5]]`, ""},
		{"run-widths", `[[1]]`, `true`},
		{"level-spreads", `[[1,null,null,2]]`, ""},
		{"level-spreads", `[[null,1]]`, ""},
		{"segment-sums", `[[1,null]]`, ""},
	} {
		p, err := store.Problem(ctx, test.slug, false)
		if err != nil {
			t.Fatal(err)
		}
		w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
		if err != nil {
			t.Fatal(err)
		}
		var args []json.RawMessage
		if err := json.Unmarshal([]byte(test.args), &args); err != nil {
			t.Fatal(err)
		}
		c := problems.Case{Args: args}
		if test.expected != "" {
			c.Expected = json.RawMessage(test.expected)
		}
		cmd := judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source", CustomCases: []problems.Case{c}}
		if _, err := store.Admit(ctx, "alice", ID(), cmd, ID()); errorCode(err) != "invalid_input" {
			t.Fatal(test, err)
		}
	}
	var submissions, jobs int
	if err := store.Pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM submissions),(SELECT count(*) FROM execution_jobs)").Scan(&submissions, &jobs); err != nil {
		t.Fatal(err)
	}
	if submissions != 0 || jobs != 0 {
		t.Fatal("invalid cases reached queue", submissions, jobs)
	}
	p, _ := store.Problem(ctx, "run-widths", false)
	w, _ := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source", CustomCases: []problems.Case{}}
	if _, err := store.Admit(ctx, "alice", "empty", cmd, "empty"); errorCode(err) != "invalid_input" {
		t.Fatal("empty suite", err)
	}
	cmd.CustomCases = []problems.Case{{Args: []json.RawMessage{json.RawMessage("[2,2,1]")}, Expected: json.RawMessage("[2,1]")}}
	admitted, err := store.Admit(ctx, "alice", "valid", cmd, "valid")
	if err != nil {
		t.Fatal(err)
	}
	var cases []byte
	if err := store.Pool.QueryRow(ctx, "SELECT cases FROM submissions WHERE id=$1", admitted.ID).Scan(&cases); err != nil {
		t.Fatal(err)
	}
	var stored []problems.Case
	if err := json.Unmarshal(cases, &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || string(stored[0].Args[0]) != "[2, 2, 1]" || string(stored[0].Expected) != "[2, 1]" {
		t.Fatal("admitted payload changed", string(cases))
	}
}
