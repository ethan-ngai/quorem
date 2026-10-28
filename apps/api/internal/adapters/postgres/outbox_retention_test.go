package postgres

import (
	"context"
	"testing"
)

func TestOutboxRetentionKeepsPendingAndRecentEvents(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `TRUNCATE membership_outbox;
 INSERT INTO membership_outbox(participant_id,occurred_at,published_at)
 SELECT gen_random_uuid(),clock_timestamp()-interval '10 days',clock_timestamp() FROM generate_series(1,260);
 INSERT INTO membership_outbox(participant_id,occurred_at,published_at) VALUES
 (gen_random_uuid(),clock_timestamp()-interval '10 days',NULL),
 (gen_random_uuid(),clock_timestamp(),clock_timestamp())`); err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err = cleanupPublishedOutbox(ctx, tx, "membership_outbox"); err != nil {
		t.Fatal(err)
	}
	var old, pending, recent int
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE published_at IS NOT NULL AND occurred_at<clock_timestamp()-interval '7 days'),
 count(*) FILTER (WHERE published_at IS NULL),
 count(*) FILTER (WHERE published_at IS NOT NULL AND occurred_at>=clock_timestamp()-interval '7 days') FROM membership_outbox`).Scan(&old, &pending, &recent); err != nil || old != 4 || pending != 1 || recent != 1 {
		t.Fatalf("retention: old=%d pending=%d recent=%d: %v", old, pending, recent, err)
	}
}
