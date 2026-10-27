// Package pgnotify owns session-capable PostgreSQL notification connections.
package pgnotify

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"time"
)

const listenerIdleTimeout = 30 * time.Second
const listenerPingTimeout = 5 * time.Second

type notificationConnection interface {
	WaitForNotification(context.Context) (*pgconn.Notification, error)
	Ping(context.Context) error
}

func Config(primary *pgx.ConnConfig, override string) (*pgx.ConnConfig, error) {
	if override != "" {
		return pgx.ParseConfig(override)
	}
	config := primary.Copy()
	labels := strings.Split(config.Host, ".")
	if len(labels) > 1 && strings.HasSuffix(config.Host, ".neon.tech") && strings.HasSuffix(labels[0], "-pooler") {
		pooled := config.Host
		labels[0] = strings.TrimSuffix(labels[0], "-pooler")
		config.Host = strings.Join(labels, ".")
		if config.TLSConfig != nil {
			config.TLSConfig.ServerName = config.Host
		}
		for _, fallback := range config.Fallbacks {
			if fallback.Host == pooled {
				fallback.Host = config.Host
				if fallback.TLSConfig != nil {
					fallback.TLSConfig.ServerName = config.Host
				}
			}
		}
	}
	return config, nil
}

func Listen(ctx context.Context, config *pgx.ConnConfig, channel string) (*pgx.Conn, error) {
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if _, err = conn.Exec(ctx, "LISTEN "+pgx.Identifier{channel}.Sanitize()); err != nil {
		closeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
		return nil, err
	}
	return conn, nil
}

// Signals coalesces commit notifications; the durable queue remains the recovery source.
func Signals(ctx context.Context, config *pgx.ConnConfig, channel string) (<-chan struct{}, func(), error) {
	attempt, done := context.WithTimeout(ctx, 5*time.Second)
	conn, err := Listen(attempt, config, channel)
	done()
	if err != nil {
		return nil, nil, err
	}
	listen, stop := context.WithCancel(ctx)
	wake := make(chan struct{}, 1)
	go func() {
		defer close(wake)
		defer func() {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = conn.Close(cleanup)
		}()
		Watch(listen, conn, func(*pgconn.Notification) {
			select {
			case wake <- struct{}{}:
			default:
			}
		})
	}()
	return wake, stop, nil
}

// Watch preserves notification order and probes idle sessions. A failed probe ends the stream.
func Watch(ctx context.Context, conn notificationConnection, receive func(*pgconn.Notification)) error {
	return watch(ctx, conn, receive, listenerIdleTimeout, listenerPingTimeout)
}

func watch(ctx context.Context, conn notificationConnection, receive func(*pgconn.Notification), idle, pingTimeout time.Duration) error {
	for {
		wait, cancel := context.WithTimeout(ctx, idle)
		notice, err := conn.WaitForNotification(wait)
		cancel()
		if notice != nil {
			receive(notice)
		}
		if err == nil {
			continue
		}
		if ctx.Err() != nil || !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		ping, cancel := context.WithTimeout(ctx, pingTimeout)
		err = conn.Ping(ping)
		cancel()
		if err != nil {
			return err
		}
	}
}
