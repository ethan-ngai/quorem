package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// DeleteInterview hides ended sessions while preserving execution and retry provenance.
func (s *Store) DeleteInterview(ctx context.Context, user, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var host, state string
	err = tx.QueryRow(ctx, `SELECT host_id,state FROM interviews WHERE id::text=$1 FOR UPDATE`, id).Scan(&host, &state)
	if err == pgx.ErrNoRows {
		return failure("not_found", 404, "Interview unavailable")
	}
	if err != nil {
		return err
	}
	if host != user {
		return failure("forbidden", 403, "Only the host can delete an interview")
	}
	if state != "closed" {
		return failure("invalid_transition", 409, "End the interview before deleting it")
	}
	if _, err = tx.Exec(ctx, `UPDATE interviews SET deleted_at=COALESCE(deleted_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE interview_guest_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE session_id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
