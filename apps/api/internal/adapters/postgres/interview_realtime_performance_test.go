package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
)

func TestInterviewReadsAndPresenceDoNotWaitForDocumentWriter(t *testing.T) {
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	ctx := context.Background()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM interviews WHERE id=$1 FOR NO KEY UPDATE", v.ID); err != nil {
		t.Fatal(err)
	}
	checks := []struct {
		name string
		run  func(context.Context) error
	}{
		{"snapshot", func(ctx context.Context) error { _, e := s.Interview(ctx, "alice", v.ID); return e }},
		{"pull", func(ctx context.Context) error {
			_, e := s.InterviewUpdates(ctx, "alice", v.ID, v.Document.Epoch, v.Document.Version)
			return e
		}},
		{"peers", func(ctx context.Context) error { _, e := s.InterviewPresence(ctx, "alice", v.ID); return e }},
		{"presence", func(ctx context.Context) error {
			_, e := s.UpdateInterviewPresence(ctx, "alice", v.ID, interviews.PresenceInput{ClientID: "window", Epoch: v.Document.Epoch, Version: v.Document.Version})
			return e
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			attempt, done := context.WithTimeout(ctx, time.Second)
			defer done()
			if err := check.run(attempt); err != nil {
				t.Fatalf("blocked by unrelated document transaction: %v", err)
			}
		})
	}
	// Document writes must still wait: removing all locks would permit lost edits.
	attempt, done := context.WithTimeout(ctx, 100*time.Millisecond)
	defer done()
	_, err = s.PushInterviewUpdates(attempt, "alice", v.ID, ID(), interviews.Push{Epoch: v.Document.Epoch, Version: v.Document.Version, Updates: []interviews.Update{{ClientID: "window", Changes: json.RawMessage(`[0,"# hello\n",65]`)}}})
	if err == nil || attempt.Err() == nil {
		t.Fatalf("document write did not serialize: %v", err)
	}
}

func TestInterviewOutboxDrainsAllBatchesOnOneWake(t *testing.T) {
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, "DELETE FROM interview_outbox"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `INSERT INTO interview_outbox(session_id,event_type) SELECT $1,'interview.document' FROM generate_series(1,150)`, v.ID); err != nil {
		t.Fatal(err)
	}
	count := 0
	if err := s.DispatchInterviewEvents(ctx, func(n realtime.Notice) error { count++; return nil }); err != nil {
		t.Fatal(err)
	}
	if count != 150 {
		t.Fatalf("only dispatched %d of 150 notices", count)
	}
	var pending int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM interview_outbox WHERE published_at IS NULL").Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("pending=%d err=%v", pending, err)
	}
}

func TestInterviewListenerUsesDedicatedSession(t *testing.T) {
	s := interviewTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	idle := s.Pool.Stat().AcquiredConns()
	wake, stop, err := s.InterviewEventNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if got := s.Pool.Stat().AcquiredConns(); got != idle {
		t.Fatalf("listener consumed query pool connection: %d -> %d", idle, got)
	}
	if _, err = s.Pool.Exec(ctx, "NOTIFY quorem_interview_outbox"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
	case <-time.After(time.Second):
		t.Fatal("notification missing")
	}
}

func TestInterviewListenerNeonDirectEndpointPreservesTLS(t *testing.T) {
	primary, err := pgx.ParseConfig("postgres://user:secret@ep-example-pooler.us-east-1.aws.neon.tech/app?sslmode=verify-full")
	if err != nil {
		t.Fatal(err)
	}
	config, err := interviewListenerConfig(primary, "")
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "ep-example.us-east-1.aws.neon.tech" || config.TLSConfig == nil || config.TLSConfig.InsecureSkipVerify || config.TLSConfig.ServerName != config.Host {
		t.Fatal("direct listener changed TLS verification")
	}
	if primary.Host != "ep-example-pooler.us-east-1.aws.neon.tech" || primary.TLSConfig.ServerName != primary.Host {
		t.Fatal("mutated primary config")
	}
	unchanged, _ := pgx.ParseConfig("postgres://user:secret@ep-example-pooler.neon.tech.example.com/app?sslmode=verify-full")
	copy, err := interviewListenerConfig(unchanged, "")
	if err != nil || copy.Host != unchanged.Host {
		t.Fatal("rewrote non-Neon host")
	}
	explicit, err := interviewListenerConfig(primary, "postgres://user:secret@direct.example.com/app?sslmode=verify-full")
	if err != nil || explicit.Host != "direct.example.com" || explicit.TLSConfig.InsecureSkipVerify {
		t.Fatal("explicit listener URL ignored")
	}
}
