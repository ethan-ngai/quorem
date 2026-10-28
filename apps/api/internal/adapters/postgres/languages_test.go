package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5/pgconn"
	"testing"
)

func TestLanguageWorkspaceAdmissionSnapshots(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	problem, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(problem.Languages) != 4 {
		t.Fatalf("languages: %+v", problem.Languages)
	}
	for _, language := range []string{"java", "typescript", "ocaml"} {
		workspace, e := s.CreateWorkspace(ctx, "alice", problem.ID, language)
		if e != nil {
			t.Fatal(e)
		}
		if workspace.Language != language {
			t.Fatal(workspace)
		}
		_, e = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "source"}, language)
		if e != nil {
			t.Fatal(e)
		}
		job, e := s.Claim(ctx)
		if e != nil {
			t.Fatal(e)
		}
		runtime, _ := execution.LanguageRuntime(language)
		if job.Language != language || job.RuntimeRevision != runtime.Revision || job.HarnessRevision != runtime.Harness {
			t.Fatal(job)
		}
		if e = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID}); e != nil {
			t.Fatal(e)
		}
		execSQL(t, s, "UPDATE users SET admission_tokens=2")
	}
	if _, err = s.CreateWorkspace(ctx, "alice", problem.ID, "rust"); err == nil {
		t.Fatal("unsupported language admitted")
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'alice',$2,'postgresql')`, ID(), problem.ID)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23503" {
		t.Fatalf("workspace accepted an unavailable problem language: %v", err)
	}
}
