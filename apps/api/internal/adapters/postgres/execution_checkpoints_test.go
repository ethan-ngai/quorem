package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestExecutionCheckpointYieldFenceAndCompletion(t *testing.T) {
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
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.YieldExecution(ctx, job); err == nil {
		t.Fatal("yield without progress accepted")
	}
	empty, err := s.LoadCheckpoint(ctx, job)
	if err != nil || empty.NextOrdinal != 0 {
		t.Fatal(empty, err)
	}
	cp := execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed","actual":1,"stdout":"private\u0000out","stderr":"private\u0000err"}`), Fatal: json.RawMessage(`{"status":"syntax_error","stderr":"fatal\u0000trace"}`), Artifact: json.RawMessage(`{"version":1,"language":"typescript","files":{"main.js":"AA=="}}`), CompilationNanos: 12345}
	if err = s.SaveCheckpoint(ctx, job, cp); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveCheckpoint(ctx, job, cp); err == nil {
		t.Fatal("duplicate checkpoint accepted")
	}
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 1, Frame: json.RawMessage(`{"status":"executed","actual":2}`), CompilationNanos: 12345, Fatal: cp.Fatal}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempts=3,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, job.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE id=$1`, job.JobID); err == nil {
		t.Fatal("old judge exhausted a checkpointed expired job")
	}
	var survived bool
	if err = s.Pool.QueryRow(ctx, `SELECT NOT finished AND EXISTS(SELECT 1 FROM execution_checkpoints WHERE job_id=execution_jobs.id) FROM execution_jobs WHERE id=$1`, job.JobID).Scan(&survived); err != nil || !survived {
		t.Fatal("checkpoint lost", survived, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempts=1,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1`, job.JobID); err != nil {
		t.Fatal(err)
	}
	if err = s.YieldExecution(ctx, job); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "queued" || got.Score != nil {
		t.Fatal(got, err)
	}
	if _, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID()); errorCode(err) != "user_busy" {
		t.Fatal("yield released owner slot", err)
	}
	if skipped, err := s.Claim(ctx); err != nil || skipped.JobID != "" {
		t.Fatal("non-resumable judge claimed checkpoint", skipped, err)
	}
	if _, present, err := s.NextRunnableExecutionDeadline(ctx, false, ""); err != nil || present {
		t.Fatal("checkpoint deadline visible to disabled judge", present, err)
	}
	bobWorkspace, err := s.CreateWorkspace(ctx, "bob", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	bobSubmission, err := s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: bobWorkspace.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Claim(ctx)
	if err != nil || other.SubmissionID != bobSubmission.ID {
		t.Fatal("ordinary job starved", other, err)
	}
	if err = s.Complete(ctx, other, execution.Completion{SubmissionID: other.SubmissionID, AttemptID: other.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempt_id=gen_random_uuid() WHERE id=$1`, job.JobID); err == nil {
		t.Fatal("old judge claimed checkpoint")
	}
	next, err := s.ClaimResumable(ctx)
	if err != nil || next.AttemptID == job.AttemptID {
		t.Fatal(next, err)
	}
	checkpoint, err := s.LoadCheckpoint(ctx, next)
	if err != nil || checkpoint.NextOrdinal != 2 || len(checkpoint.Artifact) == 0 || checkpoint.CompilationNanos != 12345 || string(checkpoint.Fatal) != string(cp.Fatal) {
		t.Fatal(checkpoint, err)
	}
	var frames []json.RawMessage
	if err = s.ReplayCheckpoint(ctx, next, checkpoint.NextOrdinal, func(_ int, raw json.RawMessage) error { frames = append(frames, raw); return nil }); err != nil || len(frames) != 2 || string(frames[0]) != string(cp.Frame) {
		t.Fatal("checkpoint replay", frames, err)
	}
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 2, Frame: json.RawMessage(`{"status":"executed"}`)}); err == nil {
		t.Fatal("stale attempt saved checkpoint")
	}
	if err = s.Complete(ctx, next, execution.Completion{SubmissionID: next.SubmissionID, AttemptID: next.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoints WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 0 {
		t.Fatal("checkpoint retained", count, err)
	}
}

func TestCheckpointCancellationFencesWritesAndScrubsPartialData(t *testing.T) {
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
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed"}`)}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Cancel(ctx, "alice", sub.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 1, Frame: json.RawMessage(`{"status":"executed"}`)}); err == nil {
		t.Fatal("cancelled checkpoint accepted")
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "checkpoint interrupted"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "cancelled" {
		t.Fatal(got, err)
	}
	var count int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoints WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 0 {
		t.Fatal("private checkpoint retained", count, err)
	}
}

func TestCheckpointRetentionScrubsTerminalPayload(t *testing.T) {
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
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO execution_checkpoints(job_id,next_ordinal) VALUES($1,1)`, job.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO execution_checkpoint_cases(job_id,ordinal,frame) VALUES($1,0,'{"status":"executed","stdout":"private"}')`, job.JobID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET admitted_at=clock_timestamp()-interval '31 days' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoints WHERE job_id=$1`, job.JobID).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("stale checkpoint retained", rows, err)
	}
}

func TestCheckpointWriteRacingCancellation(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	saves := make(chan error, 1)
	cancels := make(chan error, 1)
	go func() {
		<-start
		saves <- s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed"}`)})
	}()
	go func() { <-start; _, err := s.Cancel(ctx, "alice", sub.ID); cancels <- err }()
	close(start)
	saveErr, cancelErr := <-saves, <-cancels
	if cancelErr != nil {
		t.Fatalf("cancel failed: %v", cancelErr)
	}
	if saveErr != nil && saveErr.Error() != "execution cancelled" {
		t.Fatalf("unexpected checkpoint error: %v", saveErr)
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "interrupted"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "cancelled" {
		t.Fatal(got, err)
	}
	var count int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoints WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 0 {
		t.Fatal("cancelled data retained", count, err)
	}
}

func TestLegacyTerminalWriterTransactionallyScrubsCheckpoint(t *testing.T) {
	for _, command := range []string{
		`UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE submission_id=$1`,
		`UPDATE execution_jobs SET finished=true WHERE submission_id=$1`,
	} {
		t.Run(command, func(t *testing.T) {
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
			job, err := s.Claim(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"executed","stdout":"private"}`)}); err != nil {
				t.Fatal(err)
			}
			if err = s.YieldExecution(ctx, job); err != nil {
				t.Fatal(err)
			}
			tx, err := s.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, command, sub.ID); err != nil {
				t.Fatal(err)
			}
			var count int
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoints WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 0 {
				t.Fatal("terminal checkpoint survived", count, err)
			}
			if err = tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoint_cases WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 1 {
				t.Fatal("rolled-back cleanup persisted", count, err)
			}
			if _, err = s.Pool.Exec(ctx, command, sub.ID); err != nil {
				t.Fatal(err)
			}
			if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_checkpoint_cases WHERE job_id=$1`, job.JobID).Scan(&count); err != nil || count != 0 {
				t.Fatal("legacy terminal data retained", count, err)
			}
		})
	}
}

func TestCheckpointReplayReleasesPoolForHeartbeat(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID()); err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: i, Frame: json.RawMessage(`{"status":"executed"}`)}); err != nil {
			t.Fatal(err)
		}
	}
	config := s.Pool.Config()
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	isolated := &Store{Pool: pool}
	entered := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	done := make(chan error, 1)
	go func() {
		done <- isolated.ReplayCheckpoint(ctx, job, 5, func(i int, _ json.RawMessage) error {
			if i == 0 {
				close(entered)
				select {
				case <-release:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return nil
		})
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("replay did not start")
	}
	if alive, err := isolated.Lease(ctx, job, true); err != nil || !alive {
		t.Fatal("heartbeat blocked by replay", alive, err)
	}
	close(release)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
}

func TestCheckpointReplayFencesCancellationBetweenPages(t *testing.T) {
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
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: i, Frame: json.RawMessage(`{"status":"executed"}`)}); err != nil {
			t.Fatal(err)
		}
	}
	err = s.ReplayCheckpoint(ctx, job, 5, func(i int, _ json.RawMessage) error {
		if i == 0 {
			_, e := s.Cancel(ctx, "alice", sub.ID)
			return e
		}
		return nil
	})
	if err == nil {
		t.Fatal("replay continued after cancellation")
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "interrupted"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || got.State != "cancelled" {
		t.Fatal(got, err)
	}
}
