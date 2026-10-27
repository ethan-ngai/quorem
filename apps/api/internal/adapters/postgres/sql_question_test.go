package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
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
	d, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision)
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
	submission, err := s.AdmitInterview(ctx, "bob", room.ID, ID(), "run")
	if err != nil {
		t.Fatal(err)
	}
	var baseline string
	if err = s.Pool.QueryRow(ctx, `SELECT w.problem_version_id::text FROM submissions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.id=$1`, submission.ID).Scan(&baseline); err != nil || baseline == d.PublishedVersionID {
		t.Fatal("private version used as solo baseline", baseline, err)
	}
}
