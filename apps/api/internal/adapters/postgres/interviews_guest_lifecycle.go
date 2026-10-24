package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// A credential never changes session scope; finished or expired participation gets a fresh credential.
func (s *Store) RotateInterviewGuestCredential(ctx context.Context, credential, inviteToken string) (bool, error) {
	if !validInterviewToken(credential) {
		return true, nil
	}
	var same, expired, revoked bool
	var state string
	err := s.Pool.QueryRow(ctx, `SELECT (i.invite_hash=$2 OR i.interviewer_invite_hash=$2),i.state,g.expires_at<=clock_timestamp(),g.revoked_at IS NOT NULL OR m.removed_at IS NOT NULL OR u.disabled FROM interview_guest_sessions g JOIN interviews i ON i.id=g.session_id JOIN interview_members m ON m.session_id=g.session_id AND m.user_id=g.owner_id JOIN users u ON u.id=g.owner_id WHERE g.token_hash=$1`, Hash([]byte(credential)), Hash([]byte(inviteToken))).Scan(&same, &state, &expired, &revoked)
	if err == pgx.ErrNoRows {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if same {
		return expired && !revoked, nil
	}
	return expired || revoked || state == "closed", nil
}
