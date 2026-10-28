package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func saveInterviewFixture(ctx context.Context, tx pgx.Tx, sessionID string, fixture []byte) ([]byte, error) {
	var id []byte
	if err := tx.QueryRow(ctx, `SELECT sha256(convert_to($1::jsonb::text,'UTF8'))`, fixture).Scan(&id); err != nil {
		return nil, err
	}
	inserted, err := tx.Exec(ctx, `INSERT INTO interview_question_snapshots(session_id,id,fixture) VALUES($1,$2,$3) ON CONFLICT(session_id,id) DO NOTHING`, sessionID, id, fixture)
	if err != nil {
		return nil, err
	}
	if inserted.RowsAffected() == 0 {
		var same bool
		if err = tx.QueryRow(ctx, `SELECT fixture=$3::jsonb FROM interview_question_snapshots WHERE session_id=$1 AND id=$2`, sessionID, id, fixture).Scan(&same); err != nil {
			return nil, err
		}
		if !same {
			return nil, errors.New("interview fixture hash collision")
		}
	}
	return id, nil
}
