package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
	"os"
	"time"
)

// DispatchInterviewEvents publishes before acknowledging; a crash may replay, never skip.
func (s *Store) DispatchInterviewEvents(ctx context.Context, publish func(realtime.Notice) error) error {
	for {
		count, err := s.dispatchInterviewEventBatch(ctx, publish)
		if err != nil || count < 64 {
			return err
		}
	}
}

func (s *Store) dispatchInterviewEventBatch(ctx context.Context, publish func(realtime.Notice) error) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, interviewPendingEventsQuery)
	if err != nil {
		return 0, err
	}
	notices := []realtime.Notice{}
	for rows.Next() {
		var n realtime.Notice
		if err = rows.Scan(&n.ID, &n.AggregateID, &n.Version, &n.Type, &n.OccurredAt); err != nil {
			rows.Close()
			return 0, err
		}
		notices = append(notices, n)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return 0, err
	}
	if len(notices) == 0 {
		return 0, nil
	}
	for _, notice := range notices {
		if err = publish(notice); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, "UPDATE interview_outbox SET published_at=clock_timestamp() WHERE id=$1", notice.ID); err != nil {
			return 0, err
		}
	}
	_, err = tx.Exec(ctx, `DELETE FROM interview_outbox WHERE sequence IN (SELECT sequence FROM interview_outbox WHERE published_at IS NOT NULL AND occurred_at<clock_timestamp()-interval '7 days' ORDER BY sequence LIMIT 256)`)
	if err != nil {
		return 0, err
	}
	return len(notices), tx.Commit(ctx)
}

// InterviewEventNotifications wakes dispatch after commit; the outbox repairs lost database notices.
func (s *Store) InterviewEventNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	acquire, cancel := context.WithTimeout(ctx, 5*time.Second)
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		cancel()
		return nil, nil, err
	}
	conn, err := pgx.ConnectConfig(acquire, config)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	if _, err = conn.Exec(acquire, "LISTEN quorem_interview_outbox"); err != nil {
		cancel()
		_ = conn.Close(acquire)
		return nil, nil, err
	}
	cancel()
	listen, stop := context.WithCancel(ctx)
	wake := make(chan struct{}, 1)
	go func() {
		defer close(wake)
		// LISTEN owns a dedicated session; transaction pooling cannot preserve subscriptions.
		defer func() {
			closeCtx, done := context.WithTimeout(context.Background(), time.Second)
			defer done()
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

func interviewListenerConfig(primary *pgx.ConnConfig, override string) (*pgx.ConnConfig, error) {
	return pgnotify.Config(primary, override)
}

// Qualify the numeric column; the serialized sequence alias otherwise sorts as text.
const interviewPendingEventsQuery = `SELECT id,session_id,sequence::text,event_type,occurred_at FROM interview_outbox WHERE published_at IS NULL ORDER BY interview_outbox.sequence FOR UPDATE SKIP LOCKED LIMIT 64`
