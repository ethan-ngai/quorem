package pgnotify

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type idleConnection struct {
	notices   chan *pgconn.Notification
	pings     chan struct{}
	pingError error
}

func (f *idleConnection) WaitForNotification(ctx context.Context) (*pgconn.Notification, error) {
	select {
	case notice := <-f.notices:
		return notice, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (f *idleConnection) Ping(context.Context) error {
	select {
	case f.pings <- struct{}{}:
	default:
	}
	return f.pingError
}

func TestWatchDetectsIdleFailureAndKeepsHealthyNotifications(t *testing.T) {
	for _, fail := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		conn := &idleConnection{notices: make(chan *pgconn.Notification, 1), pings: make(chan struct{}, 1)}
		if fail {
			conn.pingError = errors.New("connection lost")
		}
		wake := make(chan struct{}, 1)
		done := make(chan struct{})
		go func() {
			defer close(done)
			watch(ctx, conn, func(*pgconn.Notification) {
				select {
				case wake <- struct{}{}:
				default:
				}
			}, 10*time.Millisecond, 20*time.Millisecond)
		}()
		select {
		case <-conn.pings:
		case <-time.After(time.Second):
			t.Fatal("idle session not checked")
		}
		if fail {
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("failed ping did not close listener")
			}
		} else {
			conn.notices <- &pgconn.Notification{}
			select {
			case <-wake:
			case <-time.After(time.Second):
				t.Fatal("healthy listener lost notice")
			}
		}
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("listener did not stop")
		}
	}
}

func TestWatchKeepsPostgresSessionAfterIdleTimeout(t *testing.T) {
	dsn := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := Listen(ctx, config, "quorem_listener_test")
	if err != nil {
		t.Fatal(err)
	}
	publisher, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer publisher.Close(context.Background())
	wake, done := make(chan struct{}, 1), make(chan struct{})
	go func() {
		defer close(done)
		watch(ctx, listener, func(*pgconn.Notification) {
			select {
			case wake <- struct{}{}:
			default:
			}
		}, 15*time.Millisecond, time.Second)
	}()
	defer func() { cancel(); <-done; listener.Close(context.Background()) }()
	time.Sleep(60 * time.Millisecond)
	if _, err := publisher.Exec(ctx, "NOTIFY quorem_listener_test"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
	case <-time.After(time.Second):
		t.Fatal("notice missing after idle heartbeat")
	}
}

type bufferedPingConnection struct {
	calls  int
	cancel context.CancelFunc
}

func (c *bufferedPingConnection) WaitForNotification(ctx context.Context) (*pgconn.Notification, error) {
	c.calls++
	switch c.calls {
	case 1:
		<-ctx.Done()
		return &pgconn.Notification{Payload: "before-ping"}, ctx.Err()
	case 2:
		return &pgconn.Notification{Payload: "during-ping"}, nil
	default:
		c.cancel()
		return nil, context.Canceled
	}
}
func (*bufferedPingConnection) Ping(context.Context) error { return nil }

func TestWatchPreservesNoticesAcrossProbe(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn := &bufferedPingConnection{cancel: cancel}
	var payloads []string
	err := watch(ctx, conn, func(n *pgconn.Notification) { payloads = append(payloads, n.Payload) }, time.Millisecond, time.Second)
	if !errors.Is(err, context.Canceled) || len(payloads) != 2 || payloads[0] != "before-ping" || payloads[1] != "during-ping" {
		t.Fatalf("notification order or cancellation lost: %v, %v", payloads, err)
	}
}
