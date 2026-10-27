package postgres

import (
	"context"
	"os"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func (s *Store) SubmissionEventNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_submission_outbox")
}

// Publish before acknowledgement; duplicate notices only trigger another authorized read.
func (s *Store) DispatchSubmissionEvents(ctx context.Context, publish func(realtime.Notice) error) error {
	return drainEventBatches(ctx, func(ctx context.Context) (int, error) {
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return 0, err
		}
		defer tx.Rollback(ctx)
		rows, err := tx.Query(ctx, `SELECT id,submission_id,sequence::text,occurred_at FROM submission_outbox WHERE published_at IS NULL ORDER BY sequence FOR UPDATE LIMIT 64`)
		if err != nil {
			return 0, err
		}
		var notices []realtime.Notice
		for rows.Next() {
			var n realtime.Notice
			if err = rows.Scan(&n.ID, &n.AggregateID, &n.Version, &n.OccurredAt); err != nil {
				rows.Close()
				return 0, err
			}
			n.Type = "submission.updated"
			notices = append(notices, n)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return 0, err
		}
		for _, n := range notices {
			if err = publish(n); err != nil {
				return 0, err
			}
			if _, err = tx.Exec(ctx, `UPDATE submission_outbox SET published_at=clock_timestamp() WHERE id=$1`, n.ID); err != nil {
				return 0, err
			}
		}
		if len(notices) > 0 {
			if _, err = tx.Exec(ctx, `DELETE FROM submission_outbox WHERE sequence IN (SELECT sequence FROM submission_outbox WHERE published_at IS NOT NULL AND occurred_at<clock_timestamp()-interval '7 days' ORDER BY sequence LIMIT 256)`); err != nil {
				return 0, err
			}
		}
		return len(notices), tx.Commit(ctx)
	})
}
