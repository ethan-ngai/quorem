package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestMatchCheckpointFailureResolvesEarlierUncertainty(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, j := range jobs {
		if j.SubmissionID == first.ID {
			earlier = j
		}
		if j.SubmissionID == second.ID {
			later = j
		}
	}
	completeScore(t, s, later, 20)
	before, err := s.Match(ctx, "alice", id)
	if err != nil || before.Outcome != nil {
		t.Fatal(before, err)
	}
	stale := earlier
	stale.AttemptID = ID()
	c := execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"runtime_error"}`)}
	if err = s.SaveCheckpoint(ctx, stale, c); err == nil {
		t.Fatal("stale checkpoint accepted")
	}
	if err = s.SaveCheckpoint(ctx, earlier, c); err != nil {
		t.Fatal(err)
	}
	after, err := s.Match(ctx, "alice", id)
	if err != nil || after.Outcome == nil || after.Outcome.Reason != "first_correct" || after.Outcome.WinnerUserID == after.HostUserID {
		t.Fatal(after, err)
	}
	visible, _ := json.Marshal(after)
	if strings.Contains(string(visible), "runtime_error") || strings.Contains(string(visible), "definite_failures") {
		t.Fatalf("private checkpoint exposed: %s", visible)
	}
	var failed int
	if err = s.Pool.QueryRow(ctx, `SELECT definite_failures FROM execution_checkpoints WHERE job_id=$1`, earlier.JobID).Scan(&failed); err != nil || failed != 1 {
		t.Fatal(failed, err)
	}
}

func TestMatchCheckpointCannotResolveAfterFreeze(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, j := range jobs {
		if j.SubmissionID == first.ID {
			earlier = j
		}
		if j.SubmissionID == second.ID {
			later = j
		}
	}
	completeScore(t, s, later, 20)
	execSQL(t, s, `UPDATE matches SET finalizing_at=clock_timestamp()-interval '121 seconds' WHERE id=$1`, id)
	if err := s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"runtime_error"}`)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Match(ctx, "alice", id)
	if err != nil || got.Outcome == nil || got.Outcome.Kind != "no_contest" {
		t.Fatal(got, err)
	}
}

func TestMatchCheckpointCompletionRace(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for range 5 {
		execSQL(t, s, `UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id IN ('alice','bob')`)
		id, _ := createPair(t, s)
		first := admitMatch(t, s, id, "alice", "submit")
		second := admitMatch(t, s, id, "bob", "submit")
		jobs := claimJobs(t, s, 2)
		var earlier, later execution.Job
		for _, j := range jobs {
			if j.SubmissionID == first.ID {
				earlier = j
			}
			if j.SubmissionID == second.ID {
				later = j
			}
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		go func() {
			<-start
			results <- s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"runtime_error"}`)})
		}()
		go func() {
			<-start
			results <- s.Complete(ctx, later, execution.Completion{SubmissionID: later.SubmissionID, AttemptID: later.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 20, Total: 20}})
		}()
		close(start)
		for range 2 {
			if err := <-results; err != nil {
				t.Fatal(err)
			}
		}
		got, err := s.Match(ctx, "alice", id)
		if err != nil || got.Outcome == nil || got.Outcome.Reason != "first_correct" || got.Outcome.WinnerUserID == got.HostUserID {
			t.Fatal(got, err)
		}
		if err = s.Complete(ctx, earlier, execution.Completion{SubmissionID: earlier.SubmissionID, AttemptID: earlier.AttemptID, Verdict: execution.WrongAnswer, Score: &execution.Score{Passed: 0, Total: 20}}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMatchCheckpointUnknownFramesDoNotProveFailure(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, j := range jobs {
		if j.SubmissionID == first.ID {
			earlier = j
		}
		if j.SubmissionID == second.ID {
			later = j
		}
	}
	completeScore(t, s, later, 20)
	if err := s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"unknown"}`)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Match(ctx, "alice", id)
	if err != nil || got.Outcome != nil {
		t.Fatalf("invalid frame settled match: %+v %v", got, err)
	}
	var failed int
	if err = s.Pool.QueryRow(ctx, `SELECT definite_failures FROM execution_checkpoints WHERE job_id=$1`, earlier.JobID).Scan(&failed); err != nil || failed != 0 {
		t.Fatal(failed, err)
	}
}

func TestMatchSampleFailureDoesNotAffectCertainty(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, j := range jobs {
		if j.SubmissionID == first.ID {
			earlier = j
		}
		if j.SubmissionID == second.ID {
			later = j
		}
	}
	completeScore(t, s, later, 20)
	spec, err := s.LoadExecution(ctx, earlier)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range spec.Cases {
		frame, err := json.Marshal(map[string]any{"status": "executed", "actual": c.Expected})
		if err != nil {
			t.Fatal(err)
		}
		if err = s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: i, Frame: frame}); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: len(spec.Cases), Frame: json.RawMessage(`{"status":"runtime_error"}`)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Match(ctx, "alice", id)
	if err != nil || got.Outcome != nil {
		t.Fatalf("sample failure settled match: %+v %v", got, err)
	}
	var failed int
	if err = s.Pool.QueryRow(ctx, `SELECT definite_failures FROM execution_checkpoints WHERE job_id=$1`, earlier.JobID).Scan(&failed); err != nil || failed != 0 {
		t.Fatal(failed, err)
	}
}

func TestMatchCheckpointRowLockCannotCrossFreeze(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, j := range jobs {
		if j.SubmissionID == first.ID {
			earlier = j
		}
		if j.SubmissionID == second.ID {
			later = j
		}
	}
	completeScore(t, s, later, 20)
	execSQL(t, s, `UPDATE matches SET finalizing_at=clock_timestamp()-interval '119.8 seconds' WHERE id=$1`, id)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT id FROM execution_jobs WHERE id=$1 FOR UPDATE`, earlier.JobID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"runtime_error"}`)})
	}()
	time.Sleep(300 * time.Millisecond)
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	got, err := s.Match(ctx, "alice", id)
	if err != nil || got.Outcome == nil || got.Outcome.Kind != "no_contest" {
		t.Fatal(got, err)
	}
}
