package postgres

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

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
	if _, err = tx.Exec(ctx, `INSERT INTO execution_checkpoint_cases(job_id,ordinal,frame) VALUES($1,$2,$3)`, uuidLookup(j.JobID), c.Ordinal, compressed); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE execution_checkpoints SET next_ordinal=next_ordinal+1,artifact=COALESCE($2::jsonb,artifact),compilation_nanos=$3,fatal=$4,last_attempt_id=$5 WHERE job_id=$1`, uuidLookup(j.JobID), nullableJSON(c.Artifact), c.CompilationNanos, nullableBytes(c.Fatal), uuidLookup(j.AttemptID)); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE execution_jobs SET attempts=1 WHERE id=$1`, uuidLookup(j.JobID)); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
