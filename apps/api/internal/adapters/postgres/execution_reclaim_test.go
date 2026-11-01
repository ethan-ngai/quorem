package postgres

import (
	"context"
	"sync"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestReclaimRequiresExactConfirmedAttempt(t *testing.T) {
	s := testStore(t)
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
	old, err := s.ClaimAfterTeardown(ctx, false, "", "test-scope")
	if err != nil || old.JobID == "" {
		t.Fatal(old, err)
	}
	before, err := s.NextExpiredAttempt(ctx, false, "test-scope")
	if err != nil || before != "" {
		t.Fatal(before, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, old.JobID); err != nil {
		t.Fatal(err)
	}
	for _, attempt := range []string{"", ID()} {
		job, e := s.ClaimAfterTeardown(ctx, false, attempt, "test-scope")
		if e != nil || job.JobID != "" {
			t.Fatalf("unconfirmed claim: %+v %v", job, e)
		}
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempt_id=$2 WHERE id=$1`, old.JobID, ID()); err == nil {
		t.Fatal("old binary replaced expired attempt")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE id=$1`, old.JobID); err == nil {
		t.Fatal("old binary finalized expired attempt")
	}
	attempt, err := s.NextExpiredAttempt(ctx, false, "test-scope")
	if err != nil || attempt != old.AttemptID {
		t.Fatal(attempt, err)
	}
	var wg sync.WaitGroup
	results := make(chan execution.Job, 2)
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j, e := s.ClaimAfterTeardown(ctx, false, attempt, "test-scope")
			results <- j
			errs <- e
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var fresh execution.Job
	count := 0
	for j := range results {
		if j.JobID != "" {
			fresh = j
			count++
		}
	}
	if count != 1 || fresh.SubmissionID != sub.ID || fresh.AttemptID == old.AttemptID {
		t.Fatalf("concurrent reclaim: count=%d job=%+v", count, fresh)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, fresh.JobID); err != nil {
		t.Fatal(err)
	}
	stale, err := s.ClaimAfterTeardown(ctx, false, attempt, "test-scope")
	if err != nil || stale.JobID != "" {
		t.Fatalf("stale confirmation reused: %+v %v", stale, err)
	}
}

func TestExpiredCancelledAttemptRequiresTeardown(t *testing.T) {
	s := testStore(t)
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
	job, err := s.ClaimAfterTeardown(ctx, false, "", "test-scope")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Cancel(ctx, "alice", sub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, job.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClaimAfterTeardown(ctx, false, "", "test-scope"); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "running" {
		t.Fatalf("premature cancellation: %+v %v", got, err)
	}
	if _, err = s.ClaimAfterTeardown(ctx, false, job.AttemptID, "test-scope"); err != nil {
		t.Fatal(err)
	}
	got, err = s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "cancelled" {
		t.Fatalf("cancellation: %+v %v", got, err)
	}
}

func TestExpiredAttemptRespectsJudgeCapabilities(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.ClaimAfterTeardown(ctx, false, "", "test-scope")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET lossless_cases=convert_to('[]','UTF8') WHERE id=$1`, old.SubmissionID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, old.JobID); err != nil {
		t.Fatal(err)
	}
	bob, err := s.CreateWorkspace(ctx, "bob", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: bob.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	attempt, err := s.NextExpiredAttempt(ctx, false, "test-scope")
	if err != nil || attempt != "" {
		t.Fatalf("unsupported attempt selected: %q %v", attempt, err)
	}
	claimed, err := s.ClaimAfterTeardown(ctx, false, attempt, "test-scope")
	if err != nil || claimed.SubmissionID != ordinary.ID {
		t.Fatalf("ordinary claim blocked: %+v %v", claimed, err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	attempt, err = s.NextExpiredAttempt(ctx, false, "test-scope")
	if err != nil || attempt != old.AttemptID {
		t.Fatalf("capable reaper skipped attempt: %q %v", attempt, err)
	}
}

func TestReclaimRequiresMatchingRecordedSandboxScope(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	original, err := s.ClaimAfterTeardown(ctx, false, "", "docker:v1:daemon-a")
	if err != nil || original.SandboxScope != "docker:v1:daemon-a" {
		t.Fatal(original, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, original.JobID); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"", "docker:v1:daemon-b", "remote:v1:namespace-a"} {
		attempt, e := s.NextExpiredAttempt(ctx, false, scope)
		if e != nil || attempt != "" {
			t.Fatalf("scope %q selected %q: %v", scope, attempt, e)
		}
		job, e := s.ClaimAfterTeardown(ctx, false, original.AttemptID, scope)
		if e != nil || job.JobID != "" {
			t.Fatalf("scope %q reclaimed %+v: %v", scope, job, e)
		}
		_, present, e := s.NextRunnableExecutionDeadline(ctx, false, scope)
		if e != nil || present {
			t.Fatalf("scope %q deadline present=%t: %v", scope, present, e)
		}
	}
	attempt, err := s.NextExpiredAttempt(ctx, false, "docker:v1:daemon-a")
	if err != nil || attempt != original.AttemptID {
		t.Fatal(attempt, err)
	}
	// An old claimant lacks the transaction-local scope and must not inherit the previous one.
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempt_id=NULL,lease_until=NULL WHERE id=$1`, original.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Claim(ctx); err == nil {
		t.Fatal("unscoped legacy claim API was accepted")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempt_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, original.JobID, ID()); err == nil {
		t.Fatal("unscoped legacy claim was accepted")
	}
	var scope *string
	if err = s.Pool.QueryRow(ctx, `SELECT sandbox_scope FROM execution_jobs WHERE id=$1`, original.JobID).Scan(&scope); err != nil || scope == nil || *scope != original.SandboxScope {
		t.Fatalf("rejected legacy claim changed scope: %v %v", scope, err)
	}
	attempt, err = s.NextExpiredAttempt(ctx, false, "docker:v1:daemon-a")
	if err != nil || attempt != "" {
		t.Fatalf("unknown legacy selected: %q %v", attempt, err)
	}
}
