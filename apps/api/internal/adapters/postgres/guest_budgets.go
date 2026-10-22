package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// Lock order: participant user, match, sponsor budget, global queue. Reservations only decrease at settlement.
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
	var jobLimit, secondsLimit int
	if err := tx.QueryRow(ctx, "SELECT host_owner_id,guest_job_limit,guest_seconds_limit FROM matches WHERE id=$1 AND EXISTS(SELECT 1 FROM guest_sessions WHERE owner_id=$2 AND match_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '2 hours')", room, owner).Scan(&sponsor, &jobLimit, &secondsLimit); err != nil {
		return "", failure("forbidden", 403, "Guest membership unavailable")
	}
	if _, err := tx.Exec(ctx, "INSERT INTO guest_sponsor_locks(user_id) VALUES($1) ON CONFLICT DO NOTHING", sponsor); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, "SELECT user_id FROM guest_sponsor_locks WHERE user_id=$1 FOR UPDATE", sponsor); err != nil {
		return "", err
	}
	c, err := capabilities(ctx, tx, sponsor)
	if err != nil {
		return "", err
	}
	var roomJobs, roomSeconds, monthJobs, monthSeconds, active int
	err = tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE match_id=$1 AND (settled_at IS NULL OR charged_seconds>0)),COALESCE(sum(COALESCE(charged_seconds,reserved_seconds)) FILTER(WHERE match_id=$1),0),count(*) FILTER(WHERE admitted_at>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND (settled_at IS NULL OR charged_seconds>0)),COALESCE(sum(COALESCE(charged_seconds,reserved_seconds)) FILTER(WHERE admitted_at>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0),count(*) FILTER(WHERE settled_at IS NULL) FROM guest_execution_usage WHERE sponsor_id=$2`, room, sponsor).Scan(&roomJobs, &roomSeconds, &monthJobs, &monthSeconds, &active)
	if err != nil {
		return "", err
	}
	if roomJobs >= jobLimit || roomSeconds+60 > secondsLimit || monthJobs >= c.GuestJobs || monthSeconds+60 > c.GuestSeconds {
		return "", failure("quota_exceeded", 429, "Guest execution budget reached")
	}
	// Infrastructure retries are refunded to the customer, but still consume a bounded platform allowance.
	var rawSeconds int
	if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(a.seconds),0) FROM execution_attempt_usage a JOIN guest_execution_usage u ON u.submission_id=a.submission_id WHERE u.sponsor_id=$1 AND u.admitted_at>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, sponsor).Scan(&rawSeconds); err != nil {
		return "", err
	}
	if rawSeconds+(active+1)*180 > c.GuestSeconds*3 {
		return "", failure("quota_exceeded", 429, "Guest platform execution allowance reached")
	}
	if active >= c.GuestConcurrency {
		return "", failure("rate_limited", 429, "Another guest execution is active; try again shortly")
	}
	return sponsor, nil
}
