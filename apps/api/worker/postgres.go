package worker

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
)

// Open is the PostgreSQL composition facade for the separately packaged runner.
func Open(ctx context.Context, url string, options ...Option) (*Service, error) {
	store, err := postgres.Open(ctx, url)
	if err != nil {
		return nil, err
	}
	service := New(store, options...)
	service.close = store.Pool.Close
	return service, nil
}
