package eventbus

import (
	"context"
	"errors"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"strconv"
)

// FromEnv chooses fanout independently of database, jobs, identity and object storage.
func FromEnv(ctx context.Context, getenv func(string) string) (realtime.PubSub, error) {
	switch getenv("QUOREM_REALTIME_PROVIDER") {
	case "", "memory":
		return nil, nil
	case "postgres-notify":
		limit := 512
		if raw := getenv("QUOREM_REALTIME_CONNECTION_LIMIT"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 4096 {
				return nil, errors.New("invalid realtime subscription capacity")
			}
			limit = parsed
		}
		return NewPostgres(ctx, getenv("DATABASE_URL"), getenv("QUOREM_DATABASE_LISTEN_URL"), limit)
	case "aws-appsync":
		a := &AppSync{HTTPURL: getenv("AWS_APPSYNC_HTTP_URL"), WebSocketURL: getenv("AWS_APPSYNC_WS_URL"), APIKey: getenv("AWS_APPSYNC_API_KEY")}
		if _, err := endpoint(a.HTTPURL, false); err != nil {
			return nil, err
		}
		if _, err := endpoint(a.WebSocketURL, true); err != nil {
			return nil, err
		}
		if a.APIKey == "" {
			cfg, err := config.LoadDefaultConfig(ctx)
			if err != nil {
				return nil, err
			}
			if cfg.Region == "" {
				return nil, errors.New("AppSync region required")
			}
			a.Region = cfg.Region
			a.Credentials = cfg.Credentials
		}
		return a, nil
	case "cloudflare-durable-objects":
		c := &Cloudflare{URL: getenv("CLOUDFLARE_REALTIME_URL"), Token: getenv("CLOUDFLARE_REALTIME_TOKEN")}
		if _, err := endpoint(c.URL, false); err != nil {
			return nil, err
		}
		if len(c.Token) < 32 {
			return nil, errors.New("relay credential requires at least 32 characters")
		}
		return c, nil
	default:
		return nil, errors.New("unknown realtime provider")
	}
}
