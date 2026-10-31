package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

func TestExecutionDeadlineTracksAvailabilityAndLease(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	if _, present, err := store.NextExecutionDeadline(ctx); err != nil || present {
		t.Fatalf("empty deadline: %v %v", present, err)
	}
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	admitted, err := store.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	delay, present, err := store.NextExecutionDeadline(ctx)
	if err != nil || !present || delay > 100*time.Millisecond {
		t.Fatalf("immediate deadline: %v %v %v", delay, present, err)
	}
	if _, err = store.Pool.Exec(ctx, `UPDATE execution_jobs SET available_at=clock_timestamp()+interval '2 seconds',lease_until=clock_timestamp()+interval '3 seconds' WHERE submission_id=$1`, admitted.ID); err != nil {
		t.Fatal(err)
	}
	delay, present, err = store.NextExecutionDeadline(ctx)
	if err != nil || !present || delay < 2500*time.Millisecond || delay > 3*time.Second {
		t.Fatalf("lease deadline: %v %v %v", delay, present, err)
	}
	if _, err = store.Pool.Exec(ctx, `UPDATE execution_jobs SET finished=true WHERE submission_id=$1`, admitted.ID); err != nil {
		t.Fatal(err)
	}
	if _, present, err = store.NextExecutionDeadline(ctx); err != nil || present {
		t.Fatalf("finished deadline: %v %v", present, err)
	}
}

func TestExecutionDeadlineNotificationsSkipLeaseExtensions(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wake, stop, err := store.ExecutionNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
	case <-time.After(time.Second):
		t.Fatal("missing admission wake")
	}
	job, err := claimTestJob(ctx, store, false)
	if err != nil || job.JobID == "" {
		t.Fatal(job, err)
	}
	select {
	case <-wake:
	case <-time.After(time.Second):
		t.Fatal("missing claim wake")
	}
	if alive, err := store.Lease(ctx, job, true); err != nil || !alive {
		t.Fatal(alive, err)
	}
	select {
	case <-wake:
		t.Fatal("lease heartbeat caused a queue wake")
	case <-time.After(80 * time.Millisecond):
	}
	if _, err = store.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '1 second' WHERE id=$1`, job.JobID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
	case <-time.After(time.Second):
		t.Fatal("shortened lease did not wake scheduler")
	}
}
