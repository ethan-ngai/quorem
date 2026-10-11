package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// DispatchMatchEvents publishes before acknowledging; a crash may replay, never skip.
func (s *Store) DispatchMatchEvents(ctx context.Context, publish func(realtime.Notice) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,match_id,version::text,event_type,occurred_at FROM match_outbox WHERE published_at IS NULL ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 64`)
	if err != nil {
		return err
	}
	notices := []realtime.Notice{}
	for rows.Next() {
		var n realtime.Notice
		if err = rows.Scan(&n.ID, &n.AggregateID, &n.Version, &n.Type, &n.OccurredAt); err != nil {
			rows.Close()
			return err
		}
		notices = append(notices, n)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	for _, notice := range notices {
		if err = publish(notice); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE match_outbox SET published_at=clock_timestamp() WHERE id=$1", notice.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
