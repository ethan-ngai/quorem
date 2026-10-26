package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sync"
	"time"
)

// Presence leases span replicas but never confer membership or decide match outcomes.
type Presence struct {
	ctx  context.Context
	pool *pgxpool.Pool
}

func NewPresence(ctx context.Context, pool *pgxpool.Pool) *Presence { return &Presence{ctx, pool} }

func (p *Presence) Connect(topic, subject string) (func(), error) {
	disconnect, _, err := p.ConnectLease(p.ctx, topic, subject)
	return disconnect, err
}

func (p *Presence) ConnectLease(parent context.Context, topic, subject string) (func(), <-chan struct{}, error) {
	if len(topic) == 0 || len(topic) > 128 || len(subject) == 0 || len(subject) > 128 {
		return nil, nil, errors.New("invalid presence subject")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", topic+":"+subject); err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM realtime_presence_leases WHERE id IN(SELECT id FROM realtime_presence_leases WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 256)`); err != nil {
		return nil, nil, err
	}
	var count int
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM realtime_presence_leases WHERE topic=$1 AND subject=$2 AND expires_at>clock_timestamp()", topic, subject).Scan(&count); err != nil {
		return nil, nil, err
	}
	if count >= 4 {
		return nil, nil, errors.New("connection capacity reached")
	}
	id := application.ID()
	if _, err = tx.Exec(ctx, "INSERT INTO realtime_presence_leases(id,topic,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '30 seconds')", id, topic, subject); err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	lease, stop := context.WithCancel(parent)
	lost := make(chan struct{})
	var once sync.Once
	disconnect := func() {
		once.Do(func() {
			stop()
			cleanup, done := context.WithTimeout(context.Background(), 2*time.Second)
			defer done()
			_, _ = p.pool.Exec(cleanup, "DELETE FROM realtime_presence_leases WHERE id=$1", id)
		})
	}
	go func() {
		defer disconnect()
		tick := time.NewTicker(10 * time.Second)
		defer tick.Stop()
		lastRenew := time.Now()
		for {
			select {
			case <-lease.Done():
				return
			case <-tick.C:
				attempt, done := context.WithTimeout(lease, 2*time.Second)
				result, err := p.pool.Exec(attempt, "UPDATE realtime_presence_leases SET expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1 AND expires_at>clock_timestamp()", id)
				done()
				if err == nil && result.RowsAffected() == 1 {
					lastRenew = time.Now()
					continue
				}
				if err == nil || time.Since(lastRenew) >= 30*time.Second {
					close(lost)
					return
				}
			}
		}
	}()
	return disconnect, lost, nil
}

func (p *Presence) Online(topic, subject string) bool {
	ctx, cancel := context.WithTimeout(p.ctx, time.Second)
	defer cancel()
	var online bool
	err := p.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM realtime_presence_leases WHERE topic=$1 AND subject=$2 AND expires_at>clock_timestamp())", topic, subject).Scan(&online)
	return err == nil && online
}

// Background replicas share one cadence; explicit commands retain full reconciliation.
func (s *Store) ReconcileBackground(ctx context.Context) error {
	var task string
	err := s.Pool.QueryRow(ctx, `INSERT INTO maintenance_schedule(task,next_run_at) VALUES('matches',clock_timestamp()+interval '1 second') ON CONFLICT(task) DO UPDATE SET next_run_at=EXCLUDED.next_run_at WHERE maintenance_schedule.next_run_at<=clock_timestamp() RETURNING task`).Scan(&task)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	return s.ReconcileMatches(ctx)
}
