package postgres

import (
	"context"
	"strings"
	"unicode/utf16"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/jackc/pgx/v5"
)

func (s *Store) InterviewPresence(ctx context.Context, user, id string) ([]interviews.Presence, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = interviewDocumentState(ctx, tx, user, id, false, false); err != nil {
		return nil, err
	}
	return readInterviewPresence(ctx, tx, id)
}
func readInterviewPresence(ctx context.Context, tx pgx.Tx, id string) ([]interviews.Presence, error) {
	rows, err := tx.Query(ctx, `SELECT p.client_id,p.user_id,u.display_name,u.profile_color,p.epoch,p.version,p.anchor,p.head FROM interview_presence p JOIN interview_members m ON m.session_id=p.session_id AND m.user_id=p.user_id AND m.removed_at IS NULL JOIN users u ON u.id=p.user_id AND NOT u.disabled JOIN interviews i ON i.id=p.session_id AND i.document_epoch=p.epoch WHERE p.session_id=$1 AND p.updated_at>clock_timestamp()-interval '20 seconds' ORDER BY p.user_id,p.client_id LIMIT 48`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []interviews.Presence{}
	for rows.Next() {
		var p interviews.Presence
		if err = rows.Scan(&p.ClientID, &p.UserID, &p.Name, &p.Color, &p.Epoch, &p.Version, &p.Anchor, &p.Head); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) UpdateInterviewPresence(ctx context.Context, user, id string, p interviews.PresenceInput) ([]interviews.Presence, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Only this actor's window quota needs serialization; document writes stay independent.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('interview-presence:' || $1 || ':' || $2,0))`, id, user); err != nil {
		return nil, err
	}
	v, err := interviewDocumentState(ctx, tx, user, id, true, false)
	if err != nil {
		return nil, err
	}
	length := len(utf16.Encode([]rune(v.snapshot.Document.Source)))
	if strings.TrimSpace(p.ClientID) == "" || len(p.ClientID) > 128 || p.Anchor < 0 || p.Head < 0 || p.Anchor > length || p.Head > length {
		return nil, failure("invalid_input", 400, "Invalid editor presence")
	}
	if p.Epoch != v.snapshot.Document.Epoch || p.Version != v.snapshot.Document.Version {
		return nil, failure("stale_version", 409, "Synchronize before sending presence")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM interview_presence WHERE session_id=$1 AND user_id=$2 AND updated_at<=clock_timestamp()-interval '20 seconds'`, id, user); err != nil {
		return nil, err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM interview_presence WHERE session_id=$1 AND user_id=$2 AND client_id<>$3`, id, user, p.ClientID).Scan(&count); err != nil {
		return nil, err
	}
	if count >= 4 {
		return nil, failure("quota_exceeded", 429, "Too many editor windows")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO interview_presence(session_id,user_id,client_id,epoch,version,anchor,head) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_id,user_id,client_id) DO UPDATE SET epoch=EXCLUDED.epoch,version=EXCLUDED.version,anchor=EXCLUDED.anchor,head=EXCLUDED.head,updated_at=clock_timestamp()`, id, user, p.ClientID, p.Epoch, p.Version, p.Anchor, p.Head); err != nil {
		return nil, err
	}
	out, err := readInterviewPresence(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	return out, tx.Commit(ctx)
}
