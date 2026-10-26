package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

func TestExecutionNotifyIsCommitDrivenAndDedicated(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wake, stop, err := store.ExecutionNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if store.Pool.Stat().AcquiredConns() != 0 {
		t.Fatal("listener consumed pooled request connection")
	}
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateWorkspace(ctx, "alice", problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	admitted, err := store.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "class Solution: pass"}, "notify-fixture")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		if time.Since(started) > time.Second {
			t.Fatal("commit wake waited for recovery tick")
		}
	case <-time.After(time.Second):
		t.Fatal("admission did not notify")
	}
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET available_at=clock_timestamp() WHERE submission_id=$1", admitted.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		t.Fatal("notification escaped before commit")
	case <-time.After(50 * time.Millisecond):
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		t.Fatal("rolled-back retry notified")
	case <-time.After(50 * time.Millisecond):
	}
	queued, running, err := store.ExecutionQueueState(ctx)
	if err != nil || queued != 1 || running != 0 {
		t.Fatalf("state=%d/%d err=%v", queued, running, err)
	}
	stop()
	select {
	case _, open := <-wake:
		if open {
			t.Fatal("unexpected notification after cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("listener leaked")
	}
}

func TestRunnerOpenDoesNotLoadInvitationSecrets(t *testing.T) {
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	t.Setenv("QUOREM_INVITE_KEY", "intentionally-invalid-api-only-key")
	store, err := OpenRunner(context.Background(), url)
	if err != nil {
		t.Fatal("runner unexpectedly required API invitation configuration")
	}
	store.Pool.Close()
}
