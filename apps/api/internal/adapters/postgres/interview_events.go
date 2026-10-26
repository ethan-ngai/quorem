package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
	"os"
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
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_interview_outbox")
}

func (s *Store) MatchEventNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_match_outbox")
}

func interviewListenerConfig(primary *pgx.ConnConfig, override string) (*pgx.ConnConfig, error) {
	return pgnotify.Config(primary, override)
}

// Qualify the numeric column; the serialized sequence alias otherwise sorts as text.
const interviewPendingEventsQuery = `SELECT id,session_id,sequence::text,event_type,occurred_at FROM interview_outbox WHERE published_at IS NULL ORDER BY interview_outbox.sequence FOR UPDATE SKIP LOCKED LIMIT 64`
