package postgres

import (
	"bytes"
	"context"
	"testing"
)

func TestInterviewFixtureDeduplicatesAndRemainsImmutable(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	first, err := saveInterviewFixture(ctx, tx, room.ID, []byte(`{"a":1,"b":2}`))
	if err != nil {
		t.Fatal(err)
	}
	second, err := saveInterviewFixture(ctx, tx, room.ID, []byte(`{"b":2,"a":1}`))
	if err != nil || !bytes.Equal(first, second) {
		t.Fatal("equivalent snapshots were not shared", err)
	}
	third, err := saveInterviewFixture(ctx, tx, room.ID, []byte(`{"a":2,"b":2}`))
	if err != nil || bytes.Equal(first, third) {
		t.Fatal("distinct snapshots were conflated", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_question_snapshots SET fixture='{}' WHERE session_id=$1 AND id=$2`, room.ID, first); err == nil {
		t.Fatal("snapshot became mutable")
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO interview_question_snapshots(session_id,id,fixture) VALUES($1,$2,'{}')`, room.ID, bytes.Repeat([]byte{0}, 32)); err == nil {
		t.Fatal("snapshot accepted a mismatched content key")
	}
	if _, err = s.CloseInterview(ctx, "alice", room.ID, ID()); err != nil {
		t.Fatal(err)
	}
	other := createInterviewTest(t, s)
	tx, err = s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = saveInterviewFixture(ctx, tx, other.ID, []byte(`{"a":1,"b":2}`)); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `DELETE FROM interviews WHERE id=$1`, room.ID); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_question_snapshots WHERE id=$1`, first).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("snapshot lifetime crossed sessions: %d %v", remaining, err)
	}
}

func TestInterviewLosslessFixtureFingerprint(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	firstRaw := []byte(`{"problem":{"examples":[{"args":["a\u0000b"]}]}}`)
	secondRaw := []byte(`{"problem":{"examples":[{"args":["ab"]}]}}`)
	first, err := saveInterviewFixture(ctx, tx, room.ID, firstRaw)
	if err != nil {
		t.Fatal(err)
	}
	again, err := saveInterviewFixture(ctx, tx, room.ID, firstRaw)
	if err != nil || !bytes.Equal(first, again) {
		t.Fatalf("snapshot not reused: %v", err)
	}
	second, err := saveInterviewFixture(ctx, tx, room.ID, secondRaw)
	if err != nil || bytes.Equal(first, second) {
		t.Fatalf("lossless collision: %v", err)
	}
	var restored []byte
	if err = tx.QueryRow(ctx, `SELECT lossless_fixture FROM interview_question_snapshots WHERE session_id=$1 AND id=$2`, room.ID, first).Scan(&restored); err != nil || !bytes.Equal(restored, firstRaw) {
		t.Fatalf("lossless fixture: %s %v", restored, err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interview_question_snapshots SET lossless_fixture='x' WHERE session_id=$1 AND id=$2`, room.ID, first); err == nil {
		t.Fatal("lossless fixture mutated")
	}
}
