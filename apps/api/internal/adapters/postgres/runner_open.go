package postgres

import "context"

// OpenRunner needs only execution persistence; invitation/auth secrets belong to the API.
func OpenRunner(ctx context.Context, url string) (*Store, error) {
	pool, err := OpenPool(ctx, url)
	if err != nil {
		return nil, err
	}
	return &Store{Pool: pool}, nil
}
