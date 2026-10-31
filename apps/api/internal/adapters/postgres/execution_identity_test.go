package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestExecutionFencesSubmissionIdentity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	var submissions [2]judging.Submission
	for i, owner := range []string{"alice", "bob"} {
		w, err := s.CreateWorkspace(ctx, owner, p.ID, "python")
		if err != nil {
			t.Fatal(err)
		}
		submissions[i], err = s.Admit(ctx, owner, ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "pass"}, ID())
		if err != nil {
			t.Fatal(err)
		}
	}
	first, err := claimTestJob(ctx, s, false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := claimTestJob(ctx, s, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.SubmissionID == second.SubmissionID || first.SubmissionID == "" || second.SubmissionID == "" {
		t.Fatal(first, second)
	}
	mixed := first
	mixed.SubmissionID = second.SubmissionID
	if _, err = s.LoadExecution(ctx, mixed); err == nil {
		t.Fatal("mixed identity loaded another submission")
	}
	for _, heartbeat := range []bool{false, true} {
		if alive, err := s.Lease(ctx, mixed, heartbeat); err != nil || alive {
			t.Fatalf("mixed identity retained lease: %v %v", alive, err)
		}
		if alive, err := s.Lease(ctx, first, heartbeat); err != nil || !alive {
			t.Fatalf("valid identity lost lease: %v %v", alive, err)
		}
	}
	if _, err = s.LoadExecution(ctx, first); err != nil {
		t.Fatal("valid execution unavailable", err)
	}
	if err = s.Complete(ctx, mixed, execution.Completion{SubmissionID: mixed.SubmissionID, AttemptID: mixed.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	for i, owner := range []string{"alice", "bob"} {
		got, err := s.Submission(ctx, owner, submissions[i].ID)
		if err != nil || got.State != "running" {
			t.Fatalf("mixed completion changed submission: %+v %v", got, err)
		}
	}
	for _, job := range []execution.Job{first, second} {
		if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
			t.Fatal(err)
		}
	}
	for i, owner := range []string{"alice", "bob"} {
		got, err := s.Submission(ctx, owner, submissions[i].ID)
		if err != nil || got.State != "completed" {
			t.Fatalf("valid completion failed: %+v %v", got, err)
		}
	}
}
