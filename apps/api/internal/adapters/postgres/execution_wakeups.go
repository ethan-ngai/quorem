package postgres

import (
	"context"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

// ExecutionNotifications owns a direct session only while a runner is active.
func (s *Store) ExecutionNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	setup, finish := context.WithTimeout(ctx, 5*time.Second)
	defer finish()
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	conn, err := pgx.ConnectConfig(setup, config)
	if err != nil {
		return nil, nil, err
	}
	if _, err = conn.Exec(setup, "LISTEN quorem_execution_jobs"); err != nil {
		_ = conn.Close(setup)
		return nil, nil, err
	}
	listen, stop := context.WithCancel(ctx)
	wake := make(chan struct{}, 1)
	go func() {
		defer close(wake)
		defer func() {
			closeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = conn.Close(closeCtx)
		}()
		for {
			if _, err := conn.WaitForNotification(listen); err != nil {
				return
			}
			select {
			case wake <- struct{}{}:
			default:
			}
		}
	}()
	return wake, stop, nil
}

func (s *Store) ExecutionQueueState(ctx context.Context) (queued, running int, err error) {
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE s.state='queued'),count(*) FILTER (WHERE s.state='running') FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE NOT j.finished AND s.state IN ('queued','running')`).Scan(&queued, &running)
	return
}
