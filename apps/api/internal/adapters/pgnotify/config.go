// Package pgnotify owns session-capable PostgreSQL notification connections.
package pgnotify

import (
	"context"
	"github.com/jackc/pgx/v5"
	"strings"
)

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
		_ = conn.Close(context.Background())
		return nil, err
	}
	return conn, nil
}
