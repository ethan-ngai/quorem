package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// Public traffic shares a global ceiling; connection-peer limits never trust arbitrary proxy headers.
func (s *Store) GuestRequestAllowed(ctx context.Context, peer string) (bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	for _, bucket := range []struct {
		key   string
		limit int
	}{{"global", 6000}, {"peer:" + Hash([]byte(peer)), 1200}} {
		var used int
		err = tx.QueryRow(ctx, `INSERT INTO guest_request_buckets(key,window_start,used) VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(key,window_start) DO UPDATE SET used=guest_request_buckets.used+1 WHERE guest_request_buckets.used<$2 RETURNING used`, bucket.key, bucket.limit).Scan(&used)
		if err == pgx.ErrNoRows {
			return false, nil
		}
		if err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}
