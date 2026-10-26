package postgres

import (
	"context"
	"os"

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

func (s *Store) ExecutionQueueState(ctx context.Context) (queued, running int, err error) {
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE s.state='queued'),count(*) FILTER (WHERE s.state='running') FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE NOT j.finished AND s.state IN ('queued','running')`).Scan(&queued, &running)
	return
}
