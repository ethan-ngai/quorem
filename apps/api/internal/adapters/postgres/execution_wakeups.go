package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
)

// ExecutionNotifications owns a direct session only while a runner is active.
func (s *Store) ExecutionNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_execution_jobs")
}

// NextExecutionDeadline uses the database clock for retry and abandoned-lease eligibility.
func (s *Store) NextExecutionDeadline(ctx context.Context) (time.Duration, bool, error) {
	return s.NextRunnableExecutionDeadline(ctx, true, "")
}

func (s *Store) NextRunnableExecutionDeadline(ctx context.Context, resumable bool, scope string) (time.Duration, bool, error) {
	var milliseconds int64
	err := s.Pool.QueryRow(ctx, `SELECT CASE WHEN count(*)=0 THEN -1 ELSE GREATEST(0,CEIL(EXTRACT(EPOCH FROM (MIN(GREATEST(j.available_at,COALESCE(j.lease_until,'-infinity'::timestamptz))) - clock_timestamp()))*1000)) END::bigint FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE `+runnableExecutionPredicate+` AND (j.attempt_id IS NULL OR (j.sandbox_scope=$3 AND $3<>''))`, resumable, losslessCasesEnabled(), scope).Scan(&milliseconds)
	if err != nil || milliseconds < 0 {
		return 0, false, err
	}
	return time.Duration(milliseconds) * time.Millisecond, true, nil
}

func (s *Store) ExecutionQueueState(ctx context.Context) (queued, running int, err error) {
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE s.state='queued'),count(*) FILTER (WHERE s.state='running') FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE NOT j.finished AND s.state IN ('queued','running')`).Scan(&queued, &running)
	return
}

// ConfirmExecutionQueueEmpty fences admissions already committing before a durable wake is acknowledged.
func (s *Store) ConfirmExecutionQueueEmpty(ctx context.Context) (bool, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return false, err
	}
	var pending bool
	// This separate READ COMMITTED statement sees admissions that committed during the lock wait.
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE NOT j.finished AND s.state IN ('queued','running'))`).Scan(&pending); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return !pending, nil
}
