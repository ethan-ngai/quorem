package eventbus

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/pgnotify"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sync"
	"time"
)

type postgresEnvelope struct {
	Channel string
	Notice  realtime.Notice
}

// Postgres broadcasts safe change identities to every replica; clients reload authorized state.
type Postgres struct {
	ctx    context.Context
	config *pgx.ConnConfig
	pool   *pgxpool.Pool
	mu     sync.Mutex
	hub    *realtime.Memory
	ready  bool
	limit  int
}

func NewPostgres(ctx context.Context, databaseURL, listenURL string, limit int) (*Postgres, error) {
	if limit < 1 || limit > 4096 {
		return nil, errors.New("invalid realtime subscription capacity")
	}
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid realtime database configuration")
	}
	listen, err := pgnotify.Config(config, listenURL)
	if err != nil {
		return nil, errors.New("invalid realtime listener configuration")
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid realtime database configuration")
	}
	poolConfig.MaxConns = 1
	poolConfig.MinConns = 0
	poolConfig.MinIdleConns = 0
	poolConfig.MaxConnIdleTime = 30 * time.Second
	poolConfig.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, unavailable
	}
	boot, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, err := pgnotify.Listen(boot, listen, "quorem_realtime_fanout")
	cancel()
	if err != nil {
		pool.Close()
		return nil, unavailable
	}
	p := &Postgres{ctx: ctx, config: listen, pool: pool, hub: realtime.NewMemoryWithCapacity(limit), ready: true, limit: limit}
	go p.read(conn)
	return p, nil
}

func (p *Postgres) Publish(ctx context.Context, channel string, notice realtime.Notice) error {
	if !validNotice(channel, notice) {
		return errors.New("invalid event notice")
	}
	data, err := json.Marshal(postgresEnvelope{channel, notice})
	if err != nil || len(data) > 7000 {
		return errors.New("event notice too large")
	}
	attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err = p.pool.Exec(attempt, "SELECT pg_notify('quorem_realtime_fanout',$1)", string(data)); err != nil {
		return unavailable
	}
	return nil
}

func (p *Postgres) Subscribe(ctx context.Context, channel string) (<-chan realtime.Notice, func(), error) {
	if !channelPattern.MatchString(channel) {
		return nil, nil, errors.New("invalid event channel")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.ready || p.ctx.Err() != nil {
		return nil, nil, unavailable
	}
	return p.hub.Subscribe(ctx, channel)
}

func (p *Postgres) read(conn *pgx.Conn) {
	defer p.pool.Close()
	defer func() { p.mu.Lock(); p.ready = false; p.hub.Close(); p.mu.Unlock() }()
	for p.ctx.Err() == nil {
		notification, err := conn.WaitForNotification(p.ctx)
		if err == nil {
			var envelope postgresEnvelope
			if len(notification.Payload) <= 7000 && json.Unmarshal([]byte(notification.Payload), &envelope) == nil && validNotice(envelope.Channel, envelope.Notice) {
				p.mu.Lock()
				_ = p.hub.Publish(p.ctx, envelope.Channel, envelope.Notice)
				p.mu.Unlock()
			}
			continue
		}
		closeCtx, stop := context.WithTimeout(context.Background(), time.Second)
		_ = conn.Close(closeCtx)
		stop()
		p.mu.Lock()
		p.ready = false
		p.hub.Close()
		p.hub = realtime.NewMemoryWithCapacity(p.limit)
		p.mu.Unlock()
		// Closing subscriptions forces versioned client recovery after a lost LISTEN session.
		for p.ctx.Err() == nil {
			timer := time.NewTimer(time.Second)
			select {
			case <-p.ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			attempt, cancel := context.WithTimeout(p.ctx, 5*time.Second)
			conn, err = pgnotify.Listen(attempt, p.config, "quorem_realtime_fanout")
			cancel()
			if err == nil {
				p.mu.Lock()
				p.ready = true
				p.mu.Unlock()
				break
			}
		}
	}
	if conn != nil {
		closeCtx, stop := context.WithTimeout(context.Background(), time.Second)
		_ = conn.Close(closeCtx)
		stop()
	}
}

var _ realtime.PubSub = (*Postgres)(nil)
