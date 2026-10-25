package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const executionTokenBalance = "LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0)"

// Callers lock the participant and room first; sponsor and global queue locks follow.
func ownerExecutionAdmission(ctx context.Context, tx pgx.Tx, owner string) (float64, error) {
	var busy bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=$1 AND state IN ('queued','running'))", owner).Scan(&busy); err != nil {
		return 0, err
	}
	if busy {
		return 0, failure("user_busy", 409, "Another execution is active")
	}
	var tokens float64
	var daily int
	if err := tx.QueryRow(ctx, "SELECT "+executionTokenBalance+",(SELECT count(*) FROM submissions WHERE owner_id=$1 AND admitted_at>clock_timestamp()-interval '24 hours') FROM users WHERE id=$1", owner).Scan(&tokens, &daily); err != nil {
		return 0, err
	}
	if tokens < 1 || daily >= 100 {
		return 0, failure("quota_exceeded", 429, "Execution quota reached")
	}
	return tokens, nil
}

func executionQueueAdmission(ctx context.Context, tx pgx.Tx) error {
	// Serialize the global queue count across both room types and API instances.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return err
	}
	var pending int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM execution_jobs WHERE NOT finished").Scan(&pending); err != nil {
		return err
	}
	if pending >= 200 {
		return failure("queue_saturated", 429, "Judge queue is full")
	}
	return nil
}

func guestSponsorCapacity(ctx context.Context, tx pgx.Tx, sponsor string) (bool, error) {
	if _, err := tx.Exec(ctx, "INSERT INTO guest_sponsor_locks(user_id) VALUES($1) ON CONFLICT DO NOTHING", sponsor); err != nil {
		return false, err
	}
	var locked string
	if err := tx.QueryRow(ctx, "SELECT user_id FROM guest_sponsor_locks WHERE user_id=$1 FOR UPDATE", sponsor).Scan(&locked); err != nil {
		return false, err
	}
	caps, err := capabilities(ctx, tx, sponsor)
	if err != nil {
		return false, err
	}
	active, err := activeGuestExecutions(ctx, tx, sponsor)
	return active < caps.GuestConcurrency, err
}
