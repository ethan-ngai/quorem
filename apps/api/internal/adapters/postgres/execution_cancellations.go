package postgres

import (
	"context"
	"os"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
)

// ExecutionCancellations owns one session for all active jobs in a runner.
func (s *Store) ExecutionCancellations(ctx context.Context) (<-chan string, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, err := pgnotify.Listen(attempt, config, "quorem_execution_cancel")
	cancel()
	if err != nil {
		return nil, nil, err
	}
	listen, stop := context.WithCancel(ctx)
	events := make(chan string, 64)
	go func() {
		defer close(events)
		defer func() {
			cleanup, done := context.WithTimeout(context.Background(), time.Second)
			defer done()
			_ = conn.Close(cleanup)
		}()
		for {
			notification, err := conn.WaitForNotification(listen)
			if err != nil {
				return
			}
			select {
			case events <- notification.Payload:
			case <-listen.Done():
				return
			}
		}
	}()
	return events, stop, nil
}
