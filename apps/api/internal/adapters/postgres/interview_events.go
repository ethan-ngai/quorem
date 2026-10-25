package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"time"
)

// DispatchInterviewEvents publishes before acknowledging; a crash may replay, never skip.
func (s *Store) DispatchInterviewEvents(ctx context.Context, publish func(realtime.Notice) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,session_id,sequence::text,event_type,occurred_at FROM interview_outbox WHERE published_at IS NULL ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 64`)
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
		if _, err = tx.Exec(ctx, "UPDATE interview_outbox SET published_at=clock_timestamp() WHERE id=$1", notice.ID); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `DELETE FROM interview_outbox WHERE sequence IN (SELECT sequence FROM interview_outbox WHERE published_at IS NOT NULL AND occurred_at<clock_timestamp()-interval '7 days' ORDER BY sequence LIMIT 256)`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InterviewEventNotifications wakes dispatch after commit; the outbox repairs lost database notices.
func (s *Store) InterviewEventNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	acquire, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, err := s.Pool.Acquire(acquire)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	if _, err = conn.Exec(acquire, "LISTEN quorem_interview_outbox"); err != nil {
		cancel()
		conn.Release()
		return nil, nil, err
	}
	cancel()
	listen, stop := context.WithCancel(ctx)
	wake := make(chan struct{}, 1)
	go func() {
		defer close(wake)
		// Discard the listener connection: pooled sessions must never retain LISTEN state.
		defer func() {
			raw := conn.Hijack()
			closeCtx, done := context.WithTimeout(context.Background(), time.Second)
			defer done()
			_ = raw.Close(closeCtx)
		}()
		for {
			if _, err := conn.Conn().WaitForNotification(listen); err != nil {
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
