package postgres

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

func presenceStores(t *testing.T) (context.Context, *Store, *Store) {
	t.Helper()
	databaseURL := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL enables isolated PostgreSQL presence tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	first, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Open(ctx, databaseURL)
	if err != nil {
		first.Pool.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { first.Pool.Close(); second.Pool.Close() })
	if err = first.Migrate(ctx, "../../../migrations"); err != nil {
		t.Fatal(err)
	}
	return ctx, first, second
}

func TestPostgresPresenceQuotaSpansReplicas(t *testing.T) {
	ctx, first, second := presenceStores(t)
	topic, subject := "/interviews/"+ID(), "synthetic-"+ID()
	replicas := []*Presence{NewPresence(ctx, first.Pool), NewPresence(ctx, second.Pool)}
	releases := make(chan func(), 8)
	start := make(chan struct{})
	var calls sync.WaitGroup
	for i := range 8 {
		calls.Go(func() {
			<-start
			release, err := replicas[i%2].Connect(topic, subject)
			if err == nil {
				releases <- release
			}
		})
	}
	close(start)
	calls.Wait()
	close(releases)
	active := []func(){}
	for release := range releases {
		active = append(active, release)
		defer release()
	}
	if len(active) != 4 {
		t.Fatalf("shared connection quota admitted %d instead of 4", len(active))
	}
	if !replicas[0].Online(topic, subject) || !replicas[1].Online(topic, subject) {
		t.Fatal("replicas disagree on online presence")
	}
	var leases int
	if err := first.Pool.QueryRow(ctx, "SELECT count(*) FROM realtime_presence_leases WHERE topic=$1 AND subject=$2", topic, subject).Scan(&leases); err != nil || leases != 4 {
		t.Fatalf("leases=%d err=%v", leases, err)
	}
	active[0]()
	active[0]()
	replacement, err := replicas[1].Connect(topic, subject)
	if err != nil {
		t.Fatal("disconnect did not release shared capacity", err)
	}
	replacement()
	for _, release := range active {
		release()
	}
	if replicas[0].Online(topic, subject) || replicas[1].Online(topic, subject) {
		t.Fatal("released leases remain online")
	}
}

func TestPostgresPresenceExpiryFencesOldLease(t *testing.T) {
	ctx, first, second := presenceStores(t)
	topic, subject := "/interviews/"+ID(), "synthetic-"+ID()
	old := NewPresence(ctx, first.Pool)
	next := NewPresence(ctx, second.Pool)
	release, lost, err := old.ConnectLease(ctx, topic, subject)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err = first.Pool.Exec(ctx, "UPDATE realtime_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE topic=$1 AND subject=$2", topic, subject); err != nil {
		t.Fatal(err)
	}
	if old.Online(topic, subject) || next.Online(topic, subject) {
		t.Fatal("expired lease remains online")
	}
	replacement, err := next.Connect(topic, subject)
	if err != nil {
		t.Fatal("expired lease blocked replacement", err)
	}
	defer replacement()
	wait, done := context.WithTimeout(ctx, 12*time.Second)
	defer done()
	select {
	case <-lost:
	case <-wait.Done():
		t.Fatal("expired connection did not lose its lease")
	}
	release()
	if !old.Online(topic, subject) || !next.Online(topic, subject) {
		t.Fatal("old disconnect removed the replacement lease")
	}
}

func TestPresenceRecoverySkipsOtherReplicasLockedCleanup(t *testing.T) {
	ctx, first, second := presenceStores(t)
	id := ID()
	if _, err := first.Pool.Exec(ctx, `INSERT INTO realtime_presence_leases(id,topic,subject,expires_at) VALUES($1,'expired','expired',clock_timestamp()-interval '1 minute')`, id); err != nil {
		t.Fatal(err)
	}
	defer first.Pool.Exec(ctx, "DELETE FROM realtime_presence_leases WHERE id=$1", id)
	tx, err := first.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM realtime_presence_leases WHERE id=$1 FOR UPDATE", id); err != nil {
		t.Fatal(err)
	}
	attempt, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	release, _, err := NewPresence(ctx, second.Pool).ConnectLease(attempt, "/interviews/"+ID(), ID())
	if err != nil {
		t.Fatal("unrelated expiry cleanup blocked reconnect", err)
	}
	release()
}
