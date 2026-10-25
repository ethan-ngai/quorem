package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/jackc/pgx/v5"
)

func (s *Store) RotateInvite(ctx context.Context, owner, id, key string) (matches.Created, error) {
	var result matches.Created
	err := s.matchCommand(ctx, owner, "rotate", key, id, func(tx pgx.Tx) (any, error) {
		m, err := lockMatch(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if m.host != owner || m.started != nil || m.outcome != nil {
			return nil, failure("forbidden", 403, "Only the host can rotate an open invitation")
		}
		raw := make([]byte, 32)
		if _, err = rand.Read(raw); err != nil {
			return nil, err
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		if _, err = tx.Exec(ctx, "UPDATE matches SET invite_hash=$2 WHERE id=$1", id, Hash([]byte(token))); err != nil {
			return nil, err
		}
		if err = matchEvent(ctx, tx, &m); err != nil {
			return nil, err
		}
		return matches.Created{ID: id, State: m.state, InviteURL: "/invite/" + token}, nil
	}, &result)
	return result, err
}
func (s *Store) RemoveGuest(ctx context.Context, owner, id, guest, key string) (matches.Snapshot, error) {
	return s.mutateMatch(ctx, owner, id, key, "remove-guest", guest, func(tx pgx.Tx, m *matchRecord) error {
		if m.host != owner {
			return failure("forbidden", 403, "Only the host can remove guests")
		}
		if m.started != nil {
			return failure("invalid_transition", 409, "Guest removal is available before the match starts")
		}
		var found bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=$1 AND p.owner_id=$2 AND u.kind='guest')", id, guest).Scan(&found); err != nil {
			return err
		}
		if !found {
			return failure("not_found", 404, "Guest not found")
		}
		if _, err := tx.Exec(ctx, "UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE match_id=$1 AND owner_id=$2", id, guest); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM match_participants WHERE match_id=$1 AND owner_id=$2", id, guest); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "DELETE FROM match_reservations WHERE match_id=$1 AND owner_id=$2", id, guest)
		return err
	})
}
