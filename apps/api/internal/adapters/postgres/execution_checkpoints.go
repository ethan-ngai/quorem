package postgres

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

func (s *Store) LoadCheckpoint(ctx context.Context, j execution.Job) (execution.Checkpoint, error) {
	ctx, finish := context.WithTimeout(ctx, 5*time.Second)
	defer finish()
	var c execution.Checkpoint
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(c.next_ordinal,0),c.artifact,COALESCE(c.compilation_nanos,0),c.fatal FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN execution_checkpoints c ON c.job_id=j.id WHERE j.id=$1 AND j.submission_id=$2 AND j.attempt_id=$3 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested`, uuidLookup(j.JobID), uuidLookup(j.SubmissionID), uuidLookup(j.AttemptID)).Scan(&c.NextOrdinal, &c.Artifact, &c.CompilationNanos, &c.Fatal)
	return c, err
}

func (s *Store) ReplayCheckpoint(ctx context.Context, j execution.Job, expected int, consume func(int, json.RawMessage) error) error {
	if expected < 0 || expected > 320 {
		return errors.New("invalid checkpoint prefix")
	}
	type item struct {
		ordinal int
		frame   []byte
	}
	for next := 0; next < expected; {
		// Release the connection between bounded pages, leaving pool capacity for lease heartbeats.
		query, finish := context.WithTimeout(ctx, 5*time.Second)
		rows, err := s.Pool.Query(query, `SELECT cc.ordinal,cc.frame FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN execution_checkpoints c ON c.job_id=j.id JOIN execution_checkpoint_cases cc ON cc.job_id=j.id WHERE j.id=$1 AND j.submission_id=$2 AND j.attempt_id=$3 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AND c.next_ordinal=$4 AND cc.ordinal>=$5 ORDER BY cc.ordinal LIMIT 4`, uuidLookup(j.JobID), uuidLookup(j.SubmissionID), uuidLookup(j.AttemptID), expected, next)
		if err != nil {
			finish()
			return err
		}
		page := make([]item, 0, 4)
		for rows.Next() {
			var current item
			if err = rows.Scan(&current.ordinal, &current.frame); err != nil {
				break
			}
			page = append(page, current)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		finish()
		if err != nil {
			return err
		}
		if len(page) == 0 {
			return errors.New("invalid checkpoint prefix")
		}
		for _, current := range page {
			if err = ctx.Err(); err != nil {
				return err
			}
			if current.ordinal != next || next >= expected {
				return errors.New("invalid checkpoint prefix")
			}
			decoded, e := decompressCheckpoint(current.frame)
			if e != nil {
				return e
			}
			if err = consume(current.ordinal, decoded); err != nil {
				return err
			}
			next++
		}
	}
	return nil
}

func (s *Store) SaveCheckpoint(ctx context.Context, j execution.Job, c execution.CheckpointCase) error {
	if c.Ordinal < 0 || c.Ordinal >= 320 || !json.Valid(c.Frame) || len(c.Frame) > 2<<20 || (len(c.Artifact) > 0 && (!json.Valid(c.Artifact) || len(c.Artifact) > 4<<20)) || (len(c.Fatal) > 0 && (!json.Valid(c.Fatal) || len(c.Fatal) > 2<<20)) || c.CompilationNanos < 0 || c.CompilationNanos > 120000000000 {
		return errors.New("invalid checkpoint")
	}
	compressed, err := compressCheckpoint(c.Frame)
	if err != nil {
		return err
	}
	ctx, finish := context.WithTimeout(ctx, 5*time.Second)
	defer finish()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Reconcile under the match lock before making a new bound visible.
	matchID, failed, err := checkpointMatchFailure(ctx, tx, j, c)
	if err != nil {
		return err
	}
	var match matchRecord
	if failed {
		match, err = lockMatch(ctx, tx, matchID)
		if err != nil {
			return err
		}
	}
	var live bool
	err = tx.QueryRow(ctx, `SELECT NOT s.cancel_requested FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.submission_id=$2 AND j.attempt_id=$3 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' FOR UPDATE OF j,s`, uuidLookup(j.JobID), uuidLookup(j.SubmissionID), uuidLookup(j.AttemptID)).Scan(&live)
	if err != nil {
		return err
	}
	if !live {
		return errors.New("execution cancelled")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO execution_checkpoints(job_id) VALUES($1) ON CONFLICT DO NOTHING`, uuidLookup(j.JobID)); err != nil {
		return err
	}
	var next int
	if err = tx.QueryRow(ctx, `SELECT next_ordinal FROM execution_checkpoints WHERE job_id=$1 FOR UPDATE`, uuidLookup(j.JobID)).Scan(&next); err != nil {
		return err
	}
	if next != c.Ordinal {
		return errors.New("checkpoint ordinal mismatch")
	}
	// Freeze overdue uncertainty after all row-lock waits and before recording this bound.
	if failed {
		if err = s.reconcileMatch(ctx, tx, &match); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO execution_checkpoint_cases(job_id,ordinal,frame) VALUES($1,$2,$3)`, uuidLookup(j.JobID), c.Ordinal, compressed); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE execution_checkpoints SET next_ordinal=next_ordinal+1,artifact=COALESCE($2::jsonb,artifact),compilation_nanos=$3,fatal=$4,last_attempt_id=$5,definite_failures=definite_failures+$6 WHERE job_id=$1`, uuidLookup(j.JobID), nullableJSON(c.Artifact), c.CompilationNanos, nullableBytes(c.Fatal), uuidLookup(j.AttemptID), boolInt(failed)); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE execution_jobs SET attempts=1 WHERE id=$1`, uuidLookup(j.JobID)); err != nil {
		return err
	}
	if failed {
		if err = s.reconcileMatch(ctx, tx, &match); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

// Only admitted match submit cases can provide a definitive bound; malformed data stays unknown.
func checkpointMatchFailure(ctx context.Context, tx pgx.Tx, j execution.Job, c execution.CheckpointCase) (string, bool, error) {
	var matchID string
	var rawCase, rawProblem []byte
	var level *int
	err := tx.QueryRow(ctx, `SELECT s.match_id::text,s.cases->($3::int),jsonb_build_object('signature',v.signature,'constraints',v.constraints,'odyssey',v.odyssey,'sql',v.sql_config),s.odyssey_level FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions v ON v.id=w.problem_version_id WHERE j.id=$1 AND s.id=$2 AND s.match_id IS NOT NULL AND s.kind='submit' AND $3::int<jsonb_array_length(s.cases)`, uuidLookup(j.JobID), uuidLookup(j.SubmissionID), c.Ordinal).Scan(&matchID, &rawCase, &rawProblem, &level)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var test problems.Case
	var problem problems.Problem
	var frame struct {
		Status   string          `json:"status"`
		Actual   json.RawMessage `json:"actual"`
		SQLTypes []string        `json:"sqlTypes"`
	}
	if string(rawCase) == "null" || json.Unmarshal(rawCase, &test) != nil || json.Unmarshal(rawProblem, &problem) != nil || json.Unmarshal(c.Frame, &frame) != nil || limitAdmittedOdyssey(&problem, level) != nil || problems.NewCaseValidator(problem).Validate(test, true) != nil {
		return "", false, nil
	}
	switch frame.Status {
	case "executed":
		if !json.Valid(frame.Actual) {
			return "", false, nil
		}
	case "syntax_error", "runtime_error", "time_limit", "memory_limit", "output_limit", "invalid_output":
	default:
		return "", false, nil
	}
	status, _, _, _, err := problems.NewCaseCodec(problem).Compare(test, frame.Status, frame.Actual, frame.SQLTypes)
	if err != nil {
		return "", false, nil
	}
	switch status {
	case "wrong_answer", "syntax_error", "runtime_error", "time_limit", "memory_limit", "output_limit", "invalid_output":
		return matchID, true, nil
	default:
		return "", false, nil
	}
}

func compressCheckpoint(raw []byte) ([]byte, error) {
	var output bytes.Buffer
	writer, err := gzip.NewWriterLevel(&output, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	if _, err = writer.Write(raw); err != nil {
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func decompressCheckpoint(raw []byte) (json.RawMessage, error) {
	reader, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	decoded, err := io.ReadAll(io.LimitReader(reader, (2<<20)+1))
	if err != nil || len(decoded) > 2<<20 || !json.Valid(decoded) {
		return nil, errors.New("invalid checkpoint frame")
	}
	return decoded, nil
}

func nullableBytes(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return []byte(raw)
}

func nullableJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return []byte(raw)
}

func (s *Store) YieldExecution(ctx context.Context, j execution.Job) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(740020)`); err != nil {
		return err
	}
	var cancelled bool
	err = tx.QueryRow(ctx, `SELECT s.cancel_requested FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.submission_id=$2 AND j.attempt_id=$3 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' FOR UPDATE OF j,s`, uuidLookup(j.JobID), uuidLookup(j.SubmissionID), uuidLookup(j.AttemptID)).Scan(&cancelled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if cancelled {
		if _, err = tx.Exec(ctx, `UPDATE submissions SET state='cancelled',updated_at=clock_timestamp() WHERE id=$1`, uuidLookup(j.SubmissionID)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE execution_jobs SET finished=true,attempt_id=NULL,lease_until=NULL WHERE id=$1`, uuidLookup(j.JobID)); err != nil {
			return err
		}
	} else {
		var progressed bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM execution_checkpoints WHERE job_id=$1 AND last_attempt_id=$2 AND next_ordinal>0)`, uuidLookup(j.JobID), uuidLookup(j.AttemptID)).Scan(&progressed); err != nil {
			return err
		}
		if !progressed {
			return errors.New("cannot yield without checkpoint progress")
		}
		if _, err = tx.Exec(ctx, `UPDATE execution_jobs SET attempt_id=NULL,lease_until=NULL,available_at=clock_timestamp(),attempts=0 WHERE id=$1`, uuidLookup(j.JobID)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE submissions SET state='queued',updated_at=clock_timestamp() WHERE id=$1`, uuidLookup(j.SubmissionID)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
