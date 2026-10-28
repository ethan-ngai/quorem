package postgres

import (
	"context"
	"os"
	"testing"
)

func TestActiveInterviewDraftMigrationPreservesInactiveDrafts(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	oldEpoch := ID()
	if _, err := s.Pool.Exec(ctx, `INSERT INTO interview_language_drafts(session_id,question_epoch,language,source) VALUES
 ($1,$2,'python','stale active copy'),($1,$2,'java','inactive draft'),($1,$3,'python','older question')`, v.ID, v.QuestionEpoch, oldEpoch); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../migrations/040_active_interview_drafts.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var active, inactive, old int
	var source string
	if err = s.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$2 AND language='python'),
 (SELECT count(*) FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$2 AND language='java'),
 (SELECT count(*) FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$3),
 (SELECT source FROM interviews WHERE id=$1)`, v.ID, v.QuestionEpoch, oldEpoch).Scan(&active, &inactive, &old, &source); err != nil || active != 0 || inactive != 1 || old != 1 || source != v.Document.Source {
		t.Fatalf("draft migration: active=%d inactive=%d old=%d source preserved=%v: %v", active, inactive, old, source == v.Document.Source, err)
	}
}
