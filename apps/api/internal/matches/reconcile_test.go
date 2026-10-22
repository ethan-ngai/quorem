package matches

import (
	"github.com/ethan-ngai/quorem/internal/execution"
	"testing"
	"time"
)

func TestReconcileAdmissionOrderAndUncertainty(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	accepted := func(owner string) SubmissionProgress {
		return SubmissionProgress{Owner: owner, State: "completed", Verdict: "accepted", Score: &execution.Score{Passed: 4, Total: 4}}
	}
	pending := func(owner string) SubmissionProgress { return SubmissionProgress{Owner: owner, State: "running"} }
	for _, tc := range []struct {
		name        string
		submissions []SubmissionProgress
		winner      string
		finalizing  bool
	}{
		{"first admitted accepted wins", []SubmissionProgress{accepted("bob"), accepted("alice")}, "bob", false},
		{"earlier opponent can still win", []SubmissionProgress{pending("alice"), accepted("bob")}, "", true},
		{"earlier same owner cannot change winner", []SubmissionProgress{pending("bob"), accepted("bob")}, "bob", false},
		{"later opponent cannot change winner", []SubmissionProgress{accepted("bob"), pending("alice")}, "bob", false},
		{"forfeited owner ignored", []SubmissionProgress{accepted("carol"), accepted("alice")}, "alice", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := Reconcile(now, now.Add(time.Minute), nil, []string{"alice", "bob"}, tc.submissions)
			if (result.FinalizingAt != nil) != tc.finalizing {
				t.Fatalf("finalizing=%v", result.FinalizingAt)
			}
			if tc.winner == "" {
				if result.Outcome != nil {
					t.Fatalf("premature outcome: %+v", result.Outcome)
				}
				return
			}
			if result.Outcome == nil || result.Outcome.WinnerUserID != tc.winner || result.Outcome.Reason != "first_correct" {
				t.Fatalf("outcome: %+v", result.Outcome)
			}
		})
	}
}

func TestReconcileDeadlineAndBestScore(t *testing.T) {
	deadline := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	partial := func(owner string, passed int) SubmissionProgress {
		return SubmissionProgress{Owner: owner, State: "completed", Verdict: "wrong_answer", Score: &execution.Score{Passed: passed, Total: 4}}
	}
	pending := func(owner string) SubmissionProgress { return SubmissionProgress{Owner: owner, State: "running"} }
	for _, tc := range []struct {
		name         string
		now          time.Time
		submissions  []SubmissionProgress
		kind, winner string
	}{
		{"deadline includes boundary", deadline, []SubmissionProgress{partial("alice", 3), partial("bob", 2)}, "win", "alice"},
		{"best score survives regression", deadline, []SubmissionProgress{partial("alice", 3), partial("alice", 1), partial("bob", 2)}, "win", "alice"},
		{"leader pending cannot lower best", deadline, []SubmissionProgress{partial("alice", 3), pending("alice"), partial("bob", 2)}, "win", "alice"},
		{"opponent pending delays finalization", deadline, []SubmissionProgress{partial("alice", 3), pending("bob")}, "", ""},
		{"equal scores draw", deadline, []SubmissionProgress{partial("alice", 2), partial("bob", 2)}, "draw", ""},
		{"tie pending delays finalization", deadline, []SubmissionProgress{partial("alice", 2), partial("bob", 2), pending("bob")}, "", ""},
		{"restart uses persisted deadline timeout", deadline.Add(2 * time.Minute), []SubmissionProgress{partial("alice", 3), pending("bob")}, "no_contest", ""},
		{"before deadline remains active", deadline.Add(-time.Second), []SubmissionProgress{partial("alice", 3), partial("bob", 2)}, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := Reconcile(tc.now, deadline, nil, []string{"alice", "bob"}, tc.submissions)
			if tc.kind == "" {
				if result.Outcome != nil {
					t.Fatalf("premature outcome: %+v", result.Outcome)
				}
				return
			}
			if result.Outcome == nil || result.Outcome.Kind != tc.kind || result.Outcome.WinnerUserID != tc.winner {
				t.Fatalf("outcome: %+v", result.Outcome)
			}
			if !result.FinalizingAt.Equal(deadline) {
				t.Fatalf("finalization started at %v, want deadline", result.FinalizingAt)
			}
		})
	}
}

func TestReconcilePreservesEarlyFinalizationGracePeriod(t *testing.T) {
	started := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	submissions := []SubmissionProgress{{Owner: "alice", State: "running"}, {Owner: "bob", State: "completed", Verdict: "accepted", Score: &execution.Score{Passed: 4, Total: 4}}}
	before := Reconcile(started.Add(2*time.Minute-time.Nanosecond), started.Add(time.Hour), &started, []string{"alice", "bob"}, submissions)
	if before.Outcome != nil {
		t.Fatalf("grace ended early: %+v", before.Outcome)
	}
	after := Reconcile(started.Add(2*time.Minute), started.Add(time.Hour), &started, []string{"alice", "bob"}, submissions)
	if after.Outcome == nil || after.Outcome.Kind != "no_contest" {
		t.Fatalf("missing grace timeout: %+v", after.Outcome)
	}
	if after.Progress["alice"].State != "running" || after.Progress["bob"].BestPassed != 4 {
		t.Fatalf("progress: %+v", after.Progress)
	}
}
