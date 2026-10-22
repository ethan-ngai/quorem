package postgres

import (
	"context"
	"encoding/base64"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/jackc/pgx/v5"
	"strings"
	"unicode/utf8"
)

func (s *Store) GuestIdentity(ctx context.Context, token string) (identity.Principal, error) {
	p := identity.Principal{Guest: true}
	if len(token) != 43 {
		return p, identity.ErrUnauthorized
	}
	err := s.Pool.QueryRow(ctx, `UPDATE guest_sessions g SET last_seen_at=clock_timestamp() FROM users u,match_participants p,matches m,users h WHERE g.token_hash=$1 AND u.id=g.owner_id AND u.kind='guest' AND NOT u.disabled AND p.owner_id=g.owner_id AND p.match_id=g.match_id AND m.id=g.match_id AND h.id=m.host_owner_id AND NOT h.disabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.last_seen_at>clock_timestamp()-interval '2 hours' RETURNING u.id,u.display_name,g.match_id::text,g.token_hash`, Hash([]byte(token))).Scan(&p.UserID, &p.DisplayName, &p.MatchID, &p.SessionID)
	if err != nil {
		return p, identity.ErrUnauthorized
	}
	return p, nil
}

// JoinGuest atomically claims a bounded seat using a previously issued HttpOnly credential.
func (s *Store) JoinGuest(ctx context.Context, token, credential, name string) (matches.Snapshot, error) {
	var empty matches.Snapshot
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 40 || strings.ContainsAny(name, "\r\n\t") {
		return empty, failure("invalid_input", 400, "Choose a name between 1 and 40 characters")
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 || len(credential) != 43 {
		return empty, failure("not_found", 404, "Invitation unavailable")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	hash := Hash([]byte(credential))
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,740060))", hash); err != nil {
		return empty, err
	}
	var owner, existingRoom string
	err = tx.QueryRow(ctx, "SELECT owner_id,match_id FROM guest_sessions WHERE token_hash=$1", hash).Scan(&owner, &existingRoom)
	if err == nil {
		var invitedRoom string
		if err = tx.QueryRow(ctx, "SELECT id FROM matches WHERE invite_hash=$1", Hash([]byte(token))).Scan(&invitedRoom); err != nil || invitedRoom != existingRoom {
			return empty, failure("forbidden", 403, "Guest access is limited to one lobby")
		}
		tx.Rollback(ctx)
		if _, err = s.GuestIdentity(ctx, credential); err != nil {
			return empty, failure("unauthenticated", 401, "Guest session expired or revoked")
		}
		return s.Match(ctx, owner, existingRoom)
	}
	if err != pgx.ErrNoRows {
		return empty, err
	}
	var id string
	if err = tx.QueryRow(ctx, "SELECT id FROM matches WHERE invite_hash=$1", Hash([]byte(token))).Scan(&id); err == pgx.ErrNoRows {
		return empty, failure("not_found", 404, "Invitation unavailable")
	}
	if err != nil {
		return empty, err
	}
	m, err := lockMatch(ctx, tx, id)
	if err != nil {
		return empty, err
	}
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT access_mode='guests_allowed' AND NOT admission_locked AND guest_joins<32 AND expires_at>clock_timestamp() AND state IN ('waiting','ready') FROM matches WHERE id=$1`, id).Scan(&allowed); err != nil {
		return empty, err
	}
	if !allowed {
		return empty, failure("forbidden", 403, "This lobby is not accepting guests")
	}
	c, err := capabilities(ctx, tx, m.host)
	if err != nil {
		return empty, err
	}
	if !c.HostGuests {
		return empty, failure("entitlement_required", 403, "Guest hosting is unavailable")
	}
	var seat int
	if err = tx.QueryRow(ctx, "SELECT COALESCE(min(n),0) FROM generate_series(1,$2) n WHERE NOT EXISTS(SELECT 1 FROM match_participants WHERE match_id=$1 AND seat=n)", id, m.settings.Capacity()).Scan(&seat); err != nil {
		return empty, err
	}
	if seat == 0 {
		return empty, failure("room_full", 409, "Lobby is full")
	}
	owner = ID()
	if _, err = tx.Exec(ctx, "INSERT INTO users(id,participant_id,display_name,kind) VALUES($1::text,$1::text::uuid,$2,'guest')", owner, name); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,$3)", id, owner, seat); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", owner, id); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,LEAST(clock_timestamp()+interval '24 hours',$4::timestamptz+interval '2 hours'))", hash, owner, id, m.expires); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "UPDATE matches SET guest_joins=guest_joins+1 WHERE id=$1", id); err != nil {
		return empty, err
	}
	if err = matchEvent(ctx, tx, &m); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.Match(ctx, owner, id)
}
