package eventbus

import (
	"context"
	"crypto/rand"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresFanoutReconnectClosesOldSubscriptions(t *testing.T) {
	databaseURL := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL enables isolated PostgreSQL fanout tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("invalid fixture URL")
	}
	applicationName := "quorem-fanout-test-" + rand.Text()
	query := parsed.Query()
	query.Set("application_name", applicationName)
	parsed.RawQuery = query.Encode()
	publisher, err := NewPostgres(ctx, databaseURL, databaseURL, 32)
	if err != nil {
		t.Fatal("publisher initialization", err)
	}
	subscriber, err := NewPostgres(ctx, databaseURL, parsed.String(), 32)
	if err != nil {
		t.Fatal("subscriber initialization", err)
	}
	control, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	channel := "/interviews/e994c7a7-642b-4f38-a1ed-000000000194"
	old, stop, err := subscriber.Subscribe(ctx, channel)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	notice := realtime.Notice{ID: "before-reconnect", AggregateID: "e994c7a7-642b-4f38-a1ed-000000000194", Version: "1", Type: "interview.document", OccurredAt: time.Now()}
	if err = publisher.Publish(ctx, channel, notice); err != nil {
		t.Fatal(err)
	}
	select {
	case received := <-old:
		if received.ID != notice.ID {
			t.Fatal("initial notice mismatch")
		}
	case <-ctx.Done():
		t.Fatal("initial fanout missing")
	}
	var terminated bool
	if err = control.QueryRow(ctx, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1", applicationName).Scan(&terminated); err != nil || !terminated {
		t.Fatal("could not interrupt isolated listener")
	}
	select {
	case _, open := <-old:
		if open {
			t.Fatal("old subscription stayed open after listener loss")
		}
	case <-ctx.Done():
		t.Fatal("listener loss left a stale subscription")
	}
	var recovered <-chan realtime.Notice
	var stopRecovered func()
	retry := time.NewTicker(25 * time.Millisecond)
	defer retry.Stop()
	for recovered == nil {
		recovered, stopRecovered, err = subscriber.Subscribe(ctx, channel)
		if err == nil {
			break
		}
		select {
		case <-retry.C:
		case <-ctx.Done():
			t.Fatal("listener did not reconnect")
		}
	}
	defer stopRecovered()
	notice.ID = "after-reconnect"
	notice.Version = "2"
	notice.OccurredAt = time.Now()
	if err = publisher.Publish(ctx, channel, notice); err != nil {
		t.Fatal(err)
	}
	select {
	case received := <-recovered:
		if received.ID != notice.ID {
			t.Fatal("recovered notice mismatch")
		}
	case <-ctx.Done():
		t.Fatal("recovered subscription missed notice")
	}
}
