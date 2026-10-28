package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Admission holds the interview lock, serializing snapshot creation per session.
func saveInterviewFixture(ctx context.Context, tx pgx.Tx, sessionID string, fixture []byte) ([]byte, error) {
	safe, lossless, err := caseStorageJSON(fixture, false)
	if err != nil {
		return nil, err
	}
	var id []byte
	err = tx.QueryRow(ctx, `WITH input AS (SELECT $1::uuid AS session_id,CASE WHEN $3::bytea IS NULL THEN $2::jsonb ELSE jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) END AS fixture,$3::bytea AS lossless_fixture),
 payload AS (SELECT session_id,sha256(convert_to(fixture::text,'UTF8')) AS id,fixture,lossless_fixture FROM input),
 inserted AS (INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT session_id,id,fixture,lossless_fixture FROM payload ON CONFLICT(session_id,id) DO NOTHING RETURNING id)
 SELECT id FROM inserted UNION ALL
 SELECT s.id FROM interview_question_snapshots s JOIN payload p ON s.session_id=p.session_id AND s.id=p.id AND s.fixture=p.fixture AND s.lossless_fixture IS NOT DISTINCT FROM p.lossless_fixture LIMIT 1`, sessionID, safe, lossless).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("interview fixture hash collision")
	}
	return id, err
}
