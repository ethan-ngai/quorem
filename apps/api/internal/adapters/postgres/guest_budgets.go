package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// Lock order: participant user, match, sponsor concurrency, global queue. Reservations only decrease at settlement.
func guestAdmission(ctx context.Context, tx pgx.Tx, owner, room string) (string, error) {
	var kind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM users WHERE id=$1", owner).Scan(&kind); err != nil {
		return "", err
	}
	if kind != "guest" {
		return "", nil
	}
	if room == "" {
		return "", failure("forbidden", 403, "Guests can execute only in their match")
	}
	var sponsor string
	if err := tx.QueryRow(ctx, "SELECT host_owner_id FROM matches WHERE id=$1 AND EXISTS(SELECT 1 FROM guest_sessions WHERE owner_id=$2 AND match_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '2 hours')", room, owner).Scan(&sponsor); err != nil {
		return "", failure("forbidden", 403, "Guest membership unavailable")
	}
	available, err := guestSponsorCapacity(ctx, tx, sponsor)
	if err != nil {
		return "", err
	}
	if !available {
		return "", failure("rate_limited", 429, "Another guest execution is active; try again shortly")
	}
	return sponsor, nil
}

func activeGuestExecutions(ctx context.Context, tx pgx.Tx, sponsor string) (int, error) {
	var active int
	err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM guest_execution_usage WHERE sponsor_id=$1 AND settled_at IS NULL)+(SELECT count(*) FROM interview_execution e JOIN interviews i ON i.id=e.session_id JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.owner_id WHERE i.host_id=$1 AND u.kind='guest' AND s.state IN ('queued','running'))`, sponsor).Scan(&active)
	return active, err
}
