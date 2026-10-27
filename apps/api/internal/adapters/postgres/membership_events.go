package postgres

import (
	"context"
	"os"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// MembershipRealtimeID resolves the private event topic from the verified owner.
func (s *Store) MembershipRealtimeID(ctx context.Context, owner string) (string, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT participant_id::text FROM users WHERE id=$1`, owner).Scan(&id)
	return id, err
}

func (s *Store) MembershipEventNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_membership_outbox")
}

// DispatchMembershipEvents publishes committed wakeups before acknowledging them.
func (s *Store) DispatchMembershipEvents(ctx context.Context, publish func(realtime.Notice) error) error {
	return drainEventBatches(ctx, func(ctx context.Context) (int, error) {
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return 0, err
		}
		defer tx.Rollback(ctx)
		rows, err := tx.Query(ctx, `SELECT id,participant_id,sequence::text,occurred_at FROM membership_outbox WHERE published_at IS NULL ORDER BY sequence FOR UPDATE LIMIT 64`)
		if err != nil {
			return 0, err
		}
		var notices []realtime.Notice
		for rows.Next() {
			var notice realtime.Notice
			if err = rows.Scan(&notice.ID, &notice.AggregateID, &notice.Version, &notice.OccurredAt); err != nil {
				rows.Close()
				return 0, err
			}
			notice.Type = "membership.updated"
			notices = append(notices, notice)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return 0, err
		}
		for _, notice := range notices {
			if err = publish(notice); err != nil {
				return 0, err
			}
			if _, err = tx.Exec(ctx, `UPDATE membership_outbox SET published_at=clock_timestamp() WHERE id=$1`, notice.ID); err != nil {
				return 0, err
			}
		}
		if len(notices) > 0 {
			if _, err = tx.Exec(ctx, `DELETE FROM membership_outbox WHERE sequence IN (SELECT sequence FROM membership_outbox WHERE published_at IS NOT NULL AND occurred_at<clock_timestamp()-interval '7 days' ORDER BY sequence LIMIT 256)`); err != nil {
				return 0, err
			}
		}
		if err = tx.Commit(ctx); err != nil {
			return 0, err
		}
		return len(notices), nil
	})
}
