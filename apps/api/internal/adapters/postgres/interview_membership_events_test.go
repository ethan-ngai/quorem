package postgres

import (
	"context"
	"sort"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func TestInterviewMembershipEvents(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	clear := func() {
		t.Helper()
		if _, err := s.Pool.Exec(ctx, `TRUNCATE membership_outbox`); err != nil {
			t.Fatal(err)
		}
	}
	check := func(want ...string) {
		t.Helper()
		rows, err := s.Pool.Query(ctx, `SELECT id,participant_id::text FROM users WHERE kind='account'`)
		if err != nil {
			t.Fatal(err)
		}
		owners := map[string]string{}
		for rows.Next() {
			var id, participant string
			if err := rows.Scan(&id, &participant); err != nil {
				t.Fatal(err)
			}
			owners[participant] = id
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		seen := map[string]bool{}
		if err := s.DispatchMembershipEvents(ctx, func(notice realtime.Notice) error {
			if notice.Type != "membership.updated" || owners[notice.AggregateID] == "" {
				t.Fatalf("unexpected notice: %+v", notice)
			}
			seen[owners[notice.AggregateID]] = true
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		got := make([]string, 0, len(seen))
		for id := range seen {
			got = append(got, id)
		}
		sort.Strings(got)
		sort.Strings(want)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("recipients %v, want %v", got, want)
		}
		clear()
	}
	clear()
	room := createInterviewTest(t, s)
	check("alice")
	token := strings.TrimPrefix(room.InvitePath, "/interview-invite/")
	if _, err := s.JoinInterview(ctx, "bob", token, "", ""); err != nil {
		t.Fatal(err)
	}
	check("alice", "bob")
	if _, err := s.SetInterviewMember(ctx, "alice", room.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	check("alice", "bob")
	if _, err := s.Pool.Exec(ctx, `UPDATE interviews SET title='Changed' WHERE id=$1`, room.ID); err != nil {
		t.Fatal(err)
	}
	check("alice", "bob")
	question := customInterviewQuestion()
	question.Custom.Title = "Different question"
	if _, err := s.UpdateInterviewQuestion(ctx, "alice", room.ID, ID(), question); err != nil {
		t.Fatal(err)
	}
	check("alice", "bob")
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id='bob'`, room.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	check()
	if _, err = s.Pool.Exec(ctx, `UPDATE interviews SET source='edited',document_version=document_version+1,updated_at=clock_timestamp() WHERE id=$1`, room.ID); err != nil {
		t.Fatal(err)
	}
	check()
	if _, err = s.RemoveInterviewMember(ctx, "alice", room.ID, ID(), "bob"); err != nil {
		t.Fatal(err)
	}
	check("alice", "bob")
	if _, err = s.CloseInterview(ctx, "alice", room.ID, ID()); err != nil {
		t.Fatal(err)
	}
	check("alice")
	if err = s.DeleteInterview(ctx, "alice", room.ID); err != nil {
		t.Fatal(err)
	}
	check("alice")
}
