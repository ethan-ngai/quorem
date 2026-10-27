package postgres

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
)

type deadlineReadFence struct {
	*Store
	once   sync.Once
	read   chan struct{}
	resume chan struct{}
}

func (s *deadlineReadFence) NextMatchDeadline(ctx context.Context) (time.Duration, bool, error) {
	delay, has, err := s.Store.NextMatchDeadline(ctx)
	s.once.Do(func() { close(s.read); <-s.resume })
	return delay, has, err
}

func waitMatchState(t *testing.T, s *Store, id, state string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		var got string
		if err := s.Pool.QueryRow(ctx, `SELECT state FROM matches WHERE id=$1`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got == state {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("state=%s, want %s", got, state)
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestMatchDeadlineSchedulerCommitDuringScheduleRead(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	fence := &deadlineReadFence{Store: s, read: make(chan struct{}), resume: make(chan struct{})}
	go matches.RunDeadlineScheduler(ctx, fence)
	select {
	case <-fence.read:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not read")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE matches SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1`, created.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	close(fence.resume)
	waitMatchState(t, s, created.ID, "cancelled")
}

func TestMatchDeadlineSchedulerStartupAndConcurrentReplicas(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, created.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		go matches.RunDeadlineScheduler(ctx, s)
	}
	waitMatchState(t, s, created.ID, "cancelled")
	var outcomes int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM match_outbox WHERE match_id=$1 AND event_type='match.completed'`, created.ID).Scan(&outcomes); err != nil || outcomes != 1 {
		t.Fatalf("outcomes=%d err=%v", outcomes, err)
	}
}

func TestMatchDeadlineSchedulerMovesDeadlineLater(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE matches SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1`, created.ID); err != nil {
		t.Fatal(err)
	}
	fence := &deadlineReadFence{Store: s, read: make(chan struct{}), resume: make(chan struct{})}
	go matches.RunDeadlineScheduler(ctx, fence)
	select {
	case <-fence.read:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not read")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE matches SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1`, created.ID); err != nil {
		t.Fatal(err)
	}
	close(fence.resume)
	time.Sleep(700 * time.Millisecond)
	var state string
	if err = s.Pool.QueryRow(ctx, `SELECT state FROM matches WHERE id=$1`, created.ID).Scan(&state); err != nil || state != "waiting" {
		t.Fatalf("state=%s err=%v", state, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, created.ID); err != nil {
		t.Fatal(err)
	}
	waitMatchState(t, s, created.ID, "cancelled")
}

func TestMatchDeadlineSchedulerDeadlineAndFinalization(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	id, _ := createPair(t, s)
	if _, err := s.Pool.Exec(ctx, `UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	go matches.RunDeadlineScheduler(ctx, s)
	waitMatchState(t, s, id, "completed")
}

func TestMatchDeadlineSchedulerFinalizationTimeout(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	id, _ := createPair(t, s)
	admitMatch(t, s, id, "alice", "submit")
	if _, err := s.Pool.Exec(ctx, `UPDATE matches SET state='finalizing',finalizing_at=clock_timestamp()-interval '121 seconds' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	go matches.RunDeadlineScheduler(ctx, s)
	waitMatchState(t, s, id, "completed")
	var reason string
	if err := s.Pool.QueryRow(ctx, `SELECT outcome->>'reason' FROM matches WHERE id=$1`, id).Scan(&reason); err != nil || reason != "unresolved_eligible_work" {
		t.Fatalf("reason=%q err=%v", reason, err)
	}
}

func TestMatchSchedulerReconcilesRunningSubmission(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	id, _ := createPair(t, s)
	submission := admitMatch(t, s, id, "alice", "submit")
	fence := &deadlineReadFence{Store: s, read: make(chan struct{}), resume: make(chan struct{})}
	go matches.RunDeadlineScheduler(ctx, fence)
	select {
	case <-fence.read:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not read")
	}
	close(fence.resume)
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != submission.ID {
		t.Fatal(job, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var state string
		if err = s.Pool.QueryRow(ctx, `SELECT COALESCE(submission_state,'') FROM match_participants WHERE match_id=$1 AND owner_id='alice'`, id).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("submission state=%q", state)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestMatchPendingGenerationPreservesConcurrentChange(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	submission := admitMatch(t, s, id, "alice", "submit")
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != submission.ID {
		t.Fatal(job, err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var observed int64
	if err = tx.QueryRow(ctx, `SELECT generation FROM match_reconciliation_pending WHERE match_id=$1`, id).Scan(&observed); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET state='queued' WHERE id=$1`, submission.ID); err != nil {
		t.Fatal(err)
	}
	result, err := tx.Exec(ctx, `DELETE FROM match_reconciliation_pending WHERE match_id=$1 AND generation=$2`, id, observed)
	if err != nil || result.RowsAffected() != 0 {
		t.Fatalf("newer change lost: %v %v", result, err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var newer int64
	if err = s.Pool.QueryRow(ctx, `SELECT generation FROM match_reconciliation_pending WHERE match_id=$1`, id).Scan(&newer); err != nil || newer != observed+1 {
		t.Fatalf("generation=%d err=%v", newer, err)
	}
	if n, err := s.ReconcileDueMatches(ctx); err != nil || n != 1 {
		t.Fatalf("reconcile count=%d err=%v", n, err)
	}
}
