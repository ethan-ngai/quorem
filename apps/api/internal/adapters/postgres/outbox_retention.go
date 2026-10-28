package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func cleanupPublishedOutbox(ctx context.Context, tx pgx.Tx, table string) error {
	name := pgx.Identifier{table}.Sanitize()
	_, err := tx.Exec(ctx, `DELETE FROM `+name+` WHERE sequence IN (SELECT sequence FROM `+name+` WHERE published_at IS NOT NULL AND occurred_at<statement_timestamp()-interval '7 days' ORDER BY occurred_at,sequence LIMIT 256)`)
	return err
}
