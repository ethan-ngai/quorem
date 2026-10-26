package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
	"strings"
	"unicode/utf8"
)

func (s *Store) UpdateInterviewQuestion(ctx context.Context, user, id, key string, q interviews.QuestionInput) (interviews.Snapshot, error) {
	if q.Custom != nil {
		if err := s.requireQuestionAuthor(ctx, user); err != nil {
			return interviews.Snapshot{}, err
		}
	}
	f, err := s.interviewQuestion(ctx, user, q)
	if err != nil {
		return interviews.Snapshot{}, err
	}
	return s.mutateInterview(ctx, user, id, key, "question", q, func(tx pgx.Tx, v interviewRecord) error {
		if err := requireInterviewOdyssey(ctx, tx, v.snapshot.HostID, f); err != nil {
			return err
		}
		if q.Custom != nil {
			if err := saveInterviewCustomQuestion(ctx, tx, user, f); err != nil {
				return err
			}
		}
		hints := q.Hints
		if hints == nil {
			hints = v.snapshot.Hints
		}
		if user != v.snapshot.HostID && (hints.TopicsAllowed() != v.snapshot.Hints.TopicsAllowed() || hints.ComplexityAllowed() != v.snapshot.Hints.ComplexityAllowed()) {
			return failure("forbidden", 403, "Only the host can change question hints")
		}
		data, err := encodeInterviewQuestion(f, hints)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE interviews SET question=$2,language=$3,source=$4,document_version=0,document_epoch=$5,question_epoch=$6 WHERE id=$1`, id, data, q.Language, f.Problem.StarterSource, ID(), ID())
		return err
	})
}
func (s *Store) SetInterviewMember(ctx context.Context, user, id, key, target, role string) (interviews.Snapshot, error) {
	if role != "interviewer" && role != "interviewee" {
		return interviews.Snapshot{}, failure("invalid_input", 400, "Invalid interview role")
	}
	return s.mutateInterview(ctx, user, id, key, "member", []string{target, role}, func(tx pgx.Tx, v interviewRecord) error {
		if target == v.snapshot.HostID && role != "interviewer" {
			return failure("forbidden", 403, "Host remains an interviewer")
		}
		// A role change cannot enroll arbitrary users; invitation possession authorizes admission.
		tag, err := tx.Exec(ctx, `UPDATE interview_members SET role=$3 WHERE session_id=$1 AND user_id=$2 AND removed_at IS NULL`, id, target, role)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return failure("not_found", 404, "Member unavailable")
		}
		return nil
	})
}
func (s *Store) RemoveInterviewMember(ctx context.Context, user, id, key, target string) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "remove", target, func(tx pgx.Tx, v interviewRecord) error {
		if target == v.snapshot.HostID {
			return failure("forbidden", 403, "Host cannot be removed")
		}
		if _, err := tx.Exec(ctx, `UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2`, id, target); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE interview_guest_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1 AND owner_id=$2`, id, target)
		return err
	})
}
func (s *Store) CloseInterview(ctx context.Context, user, id, key string) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "close", nil, func(tx pgx.Tx, v interviewRecord) error {
		_, err := tx.Exec(ctx, `UPDATE interviews SET state='closed' WHERE id=$1`, id)
		return err
	})
}
func (s *Store) mutateInterview(ctx context.Context, user, id, key, action string, body any, fn func(pgx.Tx, interviewRecord) error) (interviews.Snapshot, error) {
	var empty interviews.Snapshot
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, true, false)
	if err != nil {
		return empty, err
	}
	hash := interviewFingerprint(id+":"+action, body)
	prior, _, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return empty, err
	}
	if prior != "" {
		return interviewSnapshot(ctx, tx, v)
	}
	// Ending must remain available after a hosting grant is revoked.
	if action == "close" {
		if v.snapshot.State != "active" {
			return empty, failure("invalid_transition", 409, "Interview is closed")
		}
	} else if _, err = lockInterview(ctx, tx, user, id, true, true); err != nil {
		return empty, err
	}
	if err = fn(tx, v); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, `UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id); err != nil {
		return empty, err
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.Interview(ctx, user, id)
}
func (s *Store) PreviewInterviewInvite(ctx context.Context, token string) (interviews.Preview, error) {
	var v interviews.Preview
	if !validInterviewToken(token) {
		return v, failure("not_found", 404, "Invitation unavailable")
	}
	err := s.Pool.QueryRow(ctx, `SELECT i.title,i.id,i.state,CASE WHEN i.interviewer_invite_hash=$1 THEN 'interviewer' ELSE 'interviewee' END FROM interviews i JOIN users u ON u.id=i.host_id AND NOT u.disabled WHERE (i.invite_hash=$1 OR i.interviewer_invite_hash=$1) AND i.state='active' AND EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=i.host_id AND feature IN ('internal','interviews.host') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()))`, Hash([]byte(token))).Scan(&v.Title, &v.SessionID, &v.State, &v.Role)
	if err == pgx.ErrNoRows {
		return v, failure("not_found", 404, "Invitation unavailable")
	}
	return v, err
}
func validInterviewToken(token string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(raw) == 32
}
func (s *Store) InterviewGuestIdentity(ctx context.Context, token string) (identity.Principal, error) {
	var p identity.Principal
	if !validInterviewToken(token) {
		return p, identity.ErrUnauthorized
	}
	err := s.Pool.QueryRow(ctx, `SELECT u.id,u.display_name,g.token_hash FROM interview_guest_sessions g JOIN users u ON u.id=g.owner_id AND u.kind='guest' AND NOT u.disabled JOIN interview_members m ON m.session_id=g.session_id AND m.user_id=g.owner_id AND m.removed_at IS NULL JOIN interviews i ON i.id=g.session_id JOIN users h ON h.id=i.host_id AND NOT h.disabled WHERE g.token_hash=$1 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()`, Hash([]byte(token))).Scan(&p.UserID, &p.DisplayName, &p.SessionID)
	if err == pgx.ErrNoRows {
		return p, identity.ErrUnauthorized
	}
	if err != nil {
		return p, err
	}
	p.Guest = true
	return p, nil
}
func (s *Store) JoinInterview(ctx context.Context, user, token, credential, name string) (interviews.Snapshot, error) {
	var empty interviews.Snapshot
	if !validInterviewToken(token) {
		return empty, failure("not_found", 404, "Invitation unavailable")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	var id, host, state, role string
	var locked bool
	err = tx.QueryRow(ctx, `SELECT id,host_id,state,admission_locked,CASE WHEN interviewer_invite_hash=$1 THEN 'interviewer' ELSE 'interviewee' END FROM interviews WHERE invite_hash=$1 OR interviewer_invite_hash=$1 FOR UPDATE`, Hash([]byte(token))).Scan(&id, &host, &state, &locked, &role)
	if err == pgx.ErrNoRows {
		return empty, failure("not_found", 404, "Invitation unavailable")
	}
	if err != nil {
		return empty, err
	}
	if state != "active" {
		return empty, failure("invalid_transition", 409, "Interview is closed")
	}
	caps, err := capabilities(ctx, tx, host)
	if err != nil {
		return empty, err
	}
	if !caps.Interviews {
		return empty, failure("entitlement_required", 403, "Interview access is disabled")
	}
	guest := user == ""
	if guest {
		if !validInterviewToken(credential) {
			return empty, failure("unauthenticated", 401, "Guest credential required")
		}
		name = strings.TrimSpace(name)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 40 || strings.ContainsAny(name, "\r\n\t") {
			return empty, failure("invalid_input", 400, "Choose a name between 1 and 40 characters")
		}
		var priorRoom string
		var credentialValid bool
		err = tx.QueryRow(ctx, `SELECT owner_id,session_id,revoked_at IS NULL AND expires_at>clock_timestamp() FROM interview_guest_sessions WHERE token_hash=$1`, Hash([]byte(credential))).Scan(&user, &priorRoom, &credentialValid)
		if err == nil && !credentialValid {
			return empty, failure("unauthenticated", 401, "Guest session expired or revoked")
		}
		if err == nil && priorRoom != id {
			return empty, failure("forbidden", 403, "Guest credential belongs to another interview")
		}
		if err != nil && err != pgx.ErrNoRows {
			return empty, err
		}
		if err == pgx.ErrNoRows {
			var joins int
			if err = tx.QueryRow(ctx, `SELECT guest_joins FROM interviews WHERE id=$1`, id).Scan(&joins); err != nil {
				return empty, err
			}
			if joins >= 64 {
				return empty, failure("quota_exceeded", 429, "Guest admission limit reached")
			}
			user = ID()
			if _, err = tx.Exec(ctx, `INSERT INTO users(id,participant_id,display_name,kind) VALUES($1::text,$1::text::uuid,$2,'guest')`, user, name); err != nil {
				return empty, err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO interview_guest_sessions(token_hash,owner_id,session_id) VALUES($1,$2,$3)`, Hash([]byte(credential)), user, id); err != nil {
				return empty, err
			}
			if _, err = tx.Exec(ctx, `UPDATE interviews SET guest_joins=guest_joins+1 WHERE id=$1`, id); err != nil {
				return empty, err
			}
		}
	} else {
		var eligible bool
		if err = tx.QueryRow(ctx, `SELECT kind='account' AND NOT disabled FROM users WHERE id=$1`, user).Scan(&eligible); err != nil {
			return empty, err
		}
		if !eligible {
			return empty, failure("forbidden", 403, "Sign in or join as an interview guest")
		}
	}
	var removed bool
	err = tx.QueryRow(ctx, `SELECT removed_at IS NOT NULL FROM interview_members WHERE session_id=$1 AND user_id=$2`, id, user).Scan(&removed)
	if err != nil && err != pgx.ErrNoRows {
		return empty, err
	}
	if removed {
		return empty, failure("forbidden", 403, "Interview access was removed")
	}
	newMember := err == pgx.ErrNoRows
	if locked && newMember {
		return empty, failure("admission_locked", 409, "The host has locked this interview")
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM interview_members WHERE session_id=$1 AND removed_at IS NULL`, id).Scan(&count); err != nil {
		return empty, err
	}
	if count >= 12 && newMember {
		return empty, failure("room_full", 409, "Interview is full")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(session_id,user_id) DO UPDATE SET role=CASE WHEN EXCLUDED.role='interviewer' THEN 'interviewer' ELSE interview_members.role END`, id, user, role); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, `UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.Interview(ctx, user, id)
}

// Changing disclosures never replaces the question or shared document.
func (s *Store) SetInterviewHints(ctx context.Context, user, id, key string, hints problems.HintVisibility) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "hints", hints, func(tx pgx.Tx, v interviewRecord) error {
		if user != v.snapshot.HostID {
			return failure("forbidden", 403, "Only the host can change question hints")
		}
		data, err := json.Marshal(hints)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE interviews SET question=jsonb_set(question,'{hints}',$2::jsonb) WHERE id=$1`, id, data)
		return err
	})
}
