package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5/pgconn"
	"os"
	"strconv"
	"strings"
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
	if _, err = store.Pool.Exec(ctx, "TRUNCATE guest_request_buckets,access_audit,entitlement_grants,quota_overrides,guest_sessions,guest_sponsor_locks,guest_execution_usage,execution_attempt_usage,match_idempotency,match_outbox,match_reservations,match_participants,matches,cancellation_idempotency,execution_idempotency,execution_jobs,submissions,interview_question_snapshots,workspaces,problem_versions CASCADE; UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp()"); err != nil {
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

func claimTestJob(ctx context.Context, store *Store, resumable bool) (execution.Job, error) {
	return store.ClaimAfterTeardown(ctx, resumable, "", "test-scope")
}

func copyProblemFixture(t *testing.T, s *Store, id string) problems.Fixture {
	t.Helper()
	var raw []byte
	if err := s.Pool.QueryRow(context.Background(), "SELECT "+fixtureProjectionSQL("$1::uuid"), id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var f problems.Fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	version, err := strconv.Atoi(f.Problem.Version)
	if err != nil {
		t.Fatal(err)
	}
	f.Problem.ID = ID()
	f.Problem.Version = strconv.Itoa(version + 1)
	return f
}

func insertTestProblem(t *testing.T, s *Store, f problems.Fixture) {
	t.Helper()
	ctx := context.Background()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = insertProblemVersion(ctx, tx, f); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
func errorCode(err error) string {
	var e *application.Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}
func TestWorkspaceReuseAndOwner(t *testing.T) {
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
	_, err = store.Pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'bob',$2,'run','','hash','queued','[]')`, ID(), w.ID)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23503" {
		t.Fatalf("cross-owner workspace accepted: %v", err)
	}
}

func TestCleanupExpiresMatchIdempotency(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES
 ('alice','test','expired','hash','{}',statement_timestamp()-interval '1 second'),
 ('alice','test','active','hash','{}',statement_timestamp()+interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	if err := s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var expired, active bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM match_idempotency WHERE key='expired'),EXISTS(SELECT 1 FROM match_idempotency WHERE key='active')`).Scan(&expired, &active); err != nil || expired || !active {
		t.Fatalf("match idempotency retention: expired=%v active=%v: %v", expired, active, err)
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
	if err != nil || again.ID != first.ID || again.State != "queued" || again.ExecutionJobID != "" {
		t.Fatal("retry before busy", again, err)
	}
	if _, err = store.Admit(ctx, "alice", "same", cmd, "b"); errorCode(err) != "idempotency_conflict" {
		t.Fatal(err)
	}
	if _, err = store.Admit(ctx, "alice", "other", cmd, "c"); errorCode(err) != "user_busy" {
		t.Fatal(err)
	}
	job, err := claimTestJob(ctx, store, false)
	if err != nil || job.SubmissionID != first.ID {
		t.Fatal(job, err)
	}
	if replay, err := store.Admit(ctx, "alice", "same", cmd, "a"); err != nil || replay.State != "running" || replay.ID != first.ID {
		t.Fatalf("running retry: %+v %v", replay, err)
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
	if replay, err := store.Admit(ctx, "alice", "same", cmd, "a"); err != nil || replay.State != "cancelled" || replay.ID != first.ID {
		t.Fatalf("cancelled retry: %+v %v", replay, err)
	}
	second, err := store.Admit(ctx, "alice", "second", cmd, "e")
	if err != nil {
		t.Fatal(err)
	}
	old, err := claimTestJob(ctx, store, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", old.JobID); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.ClaimAfterTeardown(ctx, false, old.AttemptID, "test-scope")
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
	for i := 0; i < 20; i++ {
		status := execution.WrongAnswer
		if i < 7 {
			status = execution.Accepted
		}
		completion.HiddenCases = append(completion.HiddenCases, execution.HiddenCaseResult{Index: i, Status: status})
	}
	completion.SafeDiagnostics = []execution.Diagnostic{{Message: "secret"}}
	completion.PublicCaseResults = []execution.PublicCaseResult{{Status: "secret"}}
	if err = store.Complete(ctx, fresh, completion); err != nil {
		t.Fatal(err)
	}
	got, _ = store.Submission(ctx, "alice", second.ID)
	if got.State != "completed" || got.Score.Passed != 7 || len(got.HiddenCases) != 20 || got.HiddenCases[0].Status != execution.Accepted || got.HiddenCases[7].Status != execution.WrongAnswer || len(got.Diagnostics) != 0 || len(got.PublicCases) != 0 {
		t.Fatal("completion redaction", got)
	}
	if replay, err := store.Admit(ctx, "alice", "second", cmd, "e"); err != nil || replay.State != "completed" || replay.ID != second.ID || replay.Score == nil || replay.Score.Passed != 7 {
		t.Fatalf("completed retry: %+v %v", replay, err)
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
		job, err := claimTestJob(ctx, store, false)
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
	first, err := store.CancelWithKey(ctx, "alice", strings.ToUpper(v.ID), "cancel")
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
	var reaped string
	for i := 0; i < 3; i++ {
		job, e := store.ClaimAfterTeardown(ctx, false, reaped, "test-scope")
		if e != nil || job.JobID == "" {
			t.Fatal(job, e)
		}
		if _, e = store.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", job.JobID); e != nil {
			t.Fatal(e)
		}
		reaped = job.AttemptID
	}
	job, err := store.ClaimAfterTeardown(ctx, false, reaped, "test-scope")
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
		_, err := store.Pool.Exec(ctx, `WITH u AS (INSERT INTO users(id,display_name) VALUES($1,'Load')), w AS (INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($2,$1,$3,'python')), s AS (INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($4,$1,$2,'run','','hash','queued','[]')) INSERT INTO execution_jobs(id,submission_id) VALUES($5,$4)`, user, workspaceID, p.ID, submissionID, jobID)
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
		{"split-load", `[[1,2],3]`, ""},
		{"split-load", `[[1,-2],1]`, ""},
		{"split-load", `[[],1]`, ""},
		{"split-load", `[[2147483647,1],1]`, ""},
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
