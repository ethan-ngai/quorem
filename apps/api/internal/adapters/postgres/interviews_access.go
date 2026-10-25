package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/jackc/pgx/v5"
)

// Serialize admission changes with joins so a successful lock immediately blocks new members.
func (s *Store) SetInterviewAdmission(ctx context.Context, user, id, key string, locked bool) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "admission", locked, func(tx pgx.Tx, v interviewRecord) error {
		if user != v.snapshot.HostID {
			return failure("forbidden", 403, "Only the host can lock the room")
		}
		_, err := tx.Exec(ctx, `UPDATE interviews SET admission_locked=$2 WHERE id=$1`, id, locked)
		return err
	})
}
