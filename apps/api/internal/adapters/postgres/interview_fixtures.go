package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Admission holds the interview lock, serializing snapshot creation per session.
func saveInterviewFixture(ctx context.Context, tx pgx.Tx, sessionID string, fixture []byte) ([]byte, error) {
	var id []byte
	err := tx.QueryRow(ctx, `WITH input AS (SELECT $1::uuid AS session_id,$2::jsonb AS fixture),
 payload AS (SELECT session_id,sha256(convert_to(fixture::text,'UTF8')) AS id,fixture FROM input),
 inserted AS (INSERT INTO interview_question_snapshots(session_id,id,fixture) SELECT session_id,id,fixture FROM payload ON CONFLICT(session_id,id) DO NOTHING RETURNING id)
 SELECT id FROM inserted UNION ALL
 SELECT s.id FROM interview_question_snapshots s JOIN payload p ON s.session_id=p.session_id AND s.id=p.id AND s.fixture=p.fixture LIMIT 1`, sessionID, fixture).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("interview fixture hash collision")
	}
	return id, err
}
