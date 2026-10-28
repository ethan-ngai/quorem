package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSQLPublicationAndAdmission(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	var test problems.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","rows":[[1]]}]}],"expected":{"rows":[[1]]}}`), &test); err != nil {
		t.Fatal(err)
	}
	c.Problem.Constraints = []problems.Constraint{{Kind: "prose", Text: "Each item has an ID."}}
	c.Problem.Slug = "sql-test"
	c.Problem.SQL = &problems.SQLConfig{Dialect: "postgresql", OutputOrder: "unordered", Tables: []problems.SQLTableSchema{{Name: "items", Columns: []problems.SQLColumn{{Name: "id", Type: "integer"}}}}, Output: []problems.SQLColumn{{Name: "id", Type: "integer"}}}
	c.Problem.Odyssey = nil
	c.Problem.Examples = []problems.ProblemExample{{Case: test}}
	c.HiddenCases = make([]problems.Case, 4)
	for i := range c.HiddenCases {
		c.HiddenCases[i] = test
	}
	runtime, _ := execution.LanguageRuntime("postgresql")
	c.Implementations = []problems.AuthoringImplementation{{LanguageImplementation: problems.LanguageImplementation{Language: "postgresql", StarterSource: "SELECT id FROM items", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness}, ReferenceSource: "SELECT id FROM items"}}
	c.Solutions = nil
	invalid := c
	invalid.Problem.Examples = []problems.ProblemExample{{Case: problems.Case{Args: nil, Expected: test.Expected}}}
	if err := problems.ValidateQuestionPublication(invalid); err == nil {
		t.Fatal("publication accepted a SQL example without a table setup")
	}
	invalid = c
	invalid.HiddenCases = []problems.Case{{Args: test.Args, Expected: json.RawMessage(`{"rows":[[1,2]]}`)}}
	if err := problems.ValidateQuestionPublication(invalid); err == nil {
		t.Fatal("publication accepted a malformed SQL result")
	}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.PublishQuestionDraftTo(ctx, "alice", d.ID, d.Revision, "private")
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, d.PublishedVersionID, true)
	if err != nil || p.SQL == nil || len(p.Languages) != 1 || p.Languages[0].Language != "postgresql" {
		t.Fatalf("%+v %v", p, err)
	}
	fork, err := s.QuestionContent(ctx, p.ID)
	if err != nil || fork.Problem.SQL == nil || len(fork.HiddenCases) != 4 {
		t.Fatal(fork, err)
	}
	bob := identity.With(context.Background(), identity.Principal{UserID: "bob"})
	if _, err = s.MatchProblem(bob, p.ID); errorCode(err) != "not_found" {
		t.Fatalf("private problem visible before match: %v", err)
	}
	if _, err = s.CreateMatch(ctx, "bob", ID(), matches.Settings{Difficulties: []string{"easy"}, SelectedProblemVersionID: p.ID}); errorCode(err) != "invalid_input" {
		t.Fatalf("non-owner hosted private problem: %v", err)
	}
	match, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulties: []string{"easy"}, QuestionFilters: matches.QuestionFilters{SQL: "true"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, match)); err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{"alice", "bob"} {
		if _, err = s.ReadyMatch(ctx, owner, match.ID, ID(), true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.MatchProblem(bob, p.ID); err != nil {
		t.Fatalf("participant cannot read private problem: %v", err)
	}
	charlie := identity.With(context.Background(), identity.Principal{UserID: "charlie"})
	if _, err = s.MatchProblem(charlie, p.ID); errorCode(err) != "not_found" {
		t.Fatalf("nonparticipant read private problem: %v", err)
	}
	for _, owner := range []string{"alice", "bob"} {
		workspace := matchWorkspace(t, s, match.ID, owner)
		var language string
		if err = s.Pool.QueryRow(ctx, "SELECT language FROM workspaces WHERE id=$1", workspace).Scan(&language); err != nil || language != "postgresql" {
			t.Fatalf("match workspace language: %s %v", language, err)
		}
		if _, err = s.Admit(ctx, owner, ID(), judging.Command{WorkspaceID: workspace, Kind: "run", Source: "SELECT id FROM items"}, ID()); err != nil {
			t.Fatal(err)
		}
	}
	adminBob := identity.With(context.Background(), identity.Principal{UserID: "bob", Admin: true})
	if _, err = s.QuestionContent(adminBob, p.ID); errorCode(err) != "not_found" {
		t.Fatalf("participant cloned private content: %v", err)
	}
	execSQL(t, s, "UPDATE match_participants SET forfeited=true WHERE match_id=$1 AND owner_id='bob'", match.ID)
	if _, err = s.MatchProblem(bob, p.ID); errorCode(err) != "not_found" {
		t.Fatalf("private access survived forfeit: %v", err)
	}
	// Clear match jobs before exercising the independent practice admission.
	if _, err = s.Pool.Exec(ctx, "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE match_id=$1)", match.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE submissions SET state='failed' WHERE match_id=$1", match.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE users SET admission_tokens=2 WHERE id='alice'"); err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "postgresql")
	if err != nil {
		t.Fatal(err)
	}
	sub, err := s.Admit(ctx, "alice", "sql-test", judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "SELECT id FROM items"}, "hash")
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatal(job, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || spec.Problem.SQL == nil || spec.Problem.SQL.Dialect != "postgresql" || len(spec.Cases) != 1 {
		t.Fatal("SQL execution projection", spec, err)
	}
	completion := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.Accepted, PublicCaseResults: []execution.PublicCaseResult{{Index: 0, Status: "accepted", SQLTypes: []string{"integer"}}}}
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || len(got.PublicCases) != 1 || len(got.PublicCases[0].SQLTypes) != 1 || got.PublicCases[0].SQLTypes[0] != "integer" {
		t.Fatal(got, err)
	}
}

func TestPrivateSQLInterviewAdmissionWithoutGlobalSQL(t *testing.T) {
	s := adminStore(t)
	if _, err := s.Pool.Exec(context.Background(), `TRUNCATE interviews CASCADE`); err != nil {
		t.Fatal(err)
	}
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	grantInternal(t, s, "alice")
	c := authoringContent(t, s)
	var test problems.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","rows":[[1]]}]}],"expected":{"rows":[[1]]}}`), &test); err != nil {
		t.Fatal(err)
	}
	c.Problem.Slug = "private-sql"
	c.Problem.Constraints = []problems.Constraint{{Kind: "prose", Text: "Each item has an ID."}}
	c.Problem.SQL = &problems.SQLConfig{Dialect: "postgresql", OutputOrder: "unordered", Tables: []problems.SQLTableSchema{{Name: "items", Columns: []problems.SQLColumn{{Name: "id", Type: "integer"}}}}, Output: []problems.SQLColumn{{Name: "id", Type: "integer"}}}
	c.Problem.Odyssey = nil
	c.Problem.Examples = []problems.ProblemExample{{Case: test}}
	c.HiddenCases = make([]problems.Case, 20)
	for i := range c.HiddenCases {
		c.HiddenCases[i] = test
	}
	c.Solutions = nil
	runtime, _ := execution.LanguageRuntime("postgresql")
	c.Implementations = []problems.AuthoringImplementation{{LanguageImplementation: problems.LanguageImplementation{Language: "postgresql", StarterSource: "SELECT id FROM items", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness}, ReferenceSource: "SELECT id FROM items"}}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.PublishQuestionDraftTo(ctx, "alice", d.ID, d.Revision, "private")
	if err != nil {
		t.Fatal(err)
	}
	room, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "SQL interview", Question: interviews.QuestionInput{Language: "postgresql", ProblemVersionID: d.PublishedVersionID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	submission, err := admitInterviewForTest(s, ctx, "bob", room.ID, ID(), "run", nil)
	if err != nil {
		t.Fatal(err)
	}
	var hasWorkspace bool
	var interviewID string
	if err = s.Pool.QueryRow(ctx, `SELECT workspace_id IS NOT NULL,interview_id::text FROM submissions WHERE id=$1`, submission.ID).Scan(&hasWorkspace, &interviewID); err != nil || hasWorkspace || interviewID != room.ID || submission.WorkspaceID != "" {
		t.Fatal("interview submission context", hasWorkspace, interviewID, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET interview_id=NULL WHERE id=$1`, submission.ID); err == nil {
		t.Fatal("submission accepted without a context")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_execution SET session_id=$2 WHERE submission_id=$1`, submission.ID, ID()); err == nil {
		t.Fatal("interview execution accepted a different session")
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES($1,'bob',$2,'run','','hash','completed','[]')`, ID(), room.ID); err == nil {
		t.Fatal("interview submission accepted without an execution snapshot")
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != submission.ID || job.ProblemVersionID != d.PublishedVersionID {
		t.Fatal("interview claim", job, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || spec.Problem.SQL == nil || !spec.PrivateDetails || spec.SubmitCasesAreSamples {
		t.Fatal("interview SQL execution", spec, err)
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE users SET admission_tokens=2 WHERE id='bob'`); err != nil {
		t.Fatal(err)
	}
	submission, err = admitInterviewForTest(s, ctx, "bob", room.ID, ID(), "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err = s.Claim(ctx)
	if err != nil || job.SubmissionID != submission.ID {
		t.Fatal(job, err)
	}
	spec, err = s.LoadExecution(ctx, job)
	if err != nil || spec.SubmitCasesAreSamples || spec.Problem.SQL == nil || len(spec.Cases) != 20 || len(spec.SubmitSamples) != 1 {
		t.Fatal("published SQL private suite", spec, err)
	}
}
