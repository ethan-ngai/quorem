package postgres

import (
	"context"
	"os"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
)

func (s *Store) MatchDeadlineNotifications(ctx context.Context) (<-chan struct{}, func(), error) {
	config, err := interviewListenerConfig(s.Pool.Config().ConnConfig, os.Getenv("QUOREM_DATABASE_LISTEN_URL"))
	if err != nil {
		return nil, nil, err
	}
	return pgnotify.Signals(ctx, config, "quorem_match_deadlines")
}

// Delay is computed against the database clock, not the host wall clock.
func (s *Store) NextMatchDeadline(ctx context.Context) (time.Duration, bool, error) {
	var micros *int64
	err := s.Pool.QueryRow(ctx, `SELECT CEIL(EXTRACT(EPOCH FROM (MIN(CASE WHEN `+matchPending+` THEN clock_timestamp() ELSE `+matchDue+` END) - clock_timestamp())) * 1000000)::bigint FROM matches WHERE state NOT IN ('completed','cancelled') OR `+matchPending).Scan(&micros)
	if err != nil {
		return 0, false, err
	}
	if micros == nil {
		return 0, false, nil
	}
	return time.Duration(*micros) * time.Microsecond, true, nil
}
