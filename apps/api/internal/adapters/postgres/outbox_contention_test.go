package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func TestOutboxDispatchWaitsForLockedRowsAndRecoversRollback(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	match, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	problem, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := s.CreateWorkspace(ctx, "alice", problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	submission, err := s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	participant, err := s.MembershipRealtimeID(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, insert string
		id           string
		dispatch     func(context.Context, func(realtime.Notice) error) error
	}{
		{"match_outbox", `INSERT INTO match_outbox(id,match_id,version,event_type) VALUES(gen_random_uuid(),$1,999,'match.updated')`, match.ID, s.DispatchMatchEvents},
		{"interview_outbox", `INSERT INTO interview_outbox(session_id,event_type) VALUES($1,'interview.session')`, room.ID, s.DispatchInterviewEvents},
		{"membership_outbox", `INSERT INTO membership_outbox(participant_id) VALUES($1)`, participant, s.DispatchMembershipEvents},
		{"submission_outbox", `INSERT INTO submission_outbox(submission_id) VALUES($1)`, submission.ID, s.DispatchSubmissionEvents},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.Pool.Exec(ctx, "DELETE FROM "+tc.name); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Pool.Exec(ctx, tc.insert, tc.id); err != nil {
				t.Fatal(err)
			}
			tx, err := s.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err = tx.Exec(ctx, "SELECT id FROM "+tc.name+" WHERE published_at IS NULL FOR UPDATE"); err != nil {
				t.Fatal(err)
			}
			attempt, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
			err = tc.dispatch(attempt, func(realtime.Notice) error { t.Fatal("locked notice published"); return nil })
			cancel()
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("locked row appeared empty: %v", err)
			}
			if err = tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			count := 0
			if err = tc.dispatch(ctx, func(realtime.Notice) error { count++; return nil }); err != nil || count != 1 {
				t.Fatalf("rollback stranded notice: count=%d error=%v", count, err)
			}
		})
	}
}
