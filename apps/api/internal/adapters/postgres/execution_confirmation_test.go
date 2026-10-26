package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEmptyConfirmationWaitsForInflightAdmissionAndUsesFreshSnapshot(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateWorkspace(ctx, "alice", problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	admitted, err := store.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "class Solution: pass"}, "confirmation-fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(ctx, "UPDATE execution_jobs SET finished=true WHERE submission_id=$1", admitted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(ctx, "UPDATE submissions SET state='completed' WHERE id=$1", admitted.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		t.Fatal(err)
	}
	pending := ID()
	if _, err = tx.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT $1,owner_id,workspace_id,kind,source,source_hash,'queued',cases FROM submissions WHERE id=$2`, pending, admitted.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) SELECT $1,$2,language,runtime_revision,harness_revision FROM execution_jobs WHERE submission_id=$3`, ID(), pending, admitted.ID); err != nil {
		t.Fatal(err)
	}
	// Ordinary MVCC polling cannot see the admission before its COMMIT completes.
	if queued, running, err := store.ExecutionQueueState(ctx); err != nil || queued != 0 || running != 0 {
		t.Fatalf("unexpected visible state: %d/%d %v", queued, running, err)
	}
	// Even a pool configured for REPEATABLE READ must take a new snapshot after waiting.
	config := store.Pool.Config()
	config.ConnConfig.RuntimeParams["default_transaction_isolation"] = "repeatable read"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	confirmationStore := &Store{Pool: pool}
	timed, finish := context.WithTimeout(ctx, 30*time.Millisecond)
	empty, err := confirmationStore.ConfirmExecutionQueueEmpty(timed)
	finish()
	if err == nil || empty {
		t.Fatalf("stalled admission acknowledged: empty=%t err=%v", empty, err)
	}
	type result struct {
		empty bool
		err   error
	}
	confirmed := make(chan result, 1)
	go func() {
		empty, err := confirmationStore.ConfirmExecutionQueueEmpty(ctx)
		confirmed <- result{empty, err}
	}()
	select {
	case result := <-confirmed:
		t.Fatalf("confirmation escaped inflight COMMIT: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	resultValue := <-confirmed
	if resultValue.err != nil || resultValue.empty {
		t.Fatalf("missed newly committed admission: %+v", resultValue)
	}
}
