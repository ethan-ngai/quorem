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
}
