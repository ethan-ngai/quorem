package delivery

import (
	"context"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

// FromEnv selects a capability independently of database, realtime, or compute providers.
// A nil queue keeps PostgreSQL polling; no cloud credentials are loaded in that mode.
func FromEnv(ctx context.Context, getenv func(string) string) (Queue, error) {
	switch getenv("QUOREM_DELIVERY_PROVIDER") {
	case "", "polling":
		return nil, nil
	case "aws-sqs":
		queueURL := getenv("AWS_SQS_QUEUE_URL")
		if queueURL == "" {
			return nil, ErrInvalid
		}
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			return nil, err
		}
		return NewSQS(sqs.NewFromConfig(cfg), queueURL)
	case "cloudflare-queues":
		return NewCloudflare(CloudflareConfig{AccountID: getenv("CLOUDFLARE_ACCOUNT_ID"), QueueID: getenv("CLOUDFLARE_QUEUE_ID"), Token: getenv("CLOUDFLARE_API_TOKEN")})
	default:
		return nil, ErrInvalid
	}
}
