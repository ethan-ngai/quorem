package matches

import (
	"github.com/ethan-ngai/quorem/internal/execution"
	"time"
)

type Progress struct {
	State      string
	BestPassed int
}
type SubmissionProgress struct {
	Owner   string
	State   string
	Verdict execution.Verdict
	Score   *execution.Score
}
type Reconciliation struct {
	Progress     map[string]Progress
	FinalizingAt *time.Time
	Outcome      *Outcome
}

// Reconcile evaluates a locked snapshot. Submissions must be in admission order;
// the repository atomically persists this decision and its outbox event.
func Reconcile(now, deadline time.Time, finalizing *time.Time, owners []string, submissions []SubmissionProgress) Reconciliation {
	result := Reconciliation{Progress: make(map[string]Progress, len(owners)), FinalizingAt: finalizing}
	for _, owner := range owners {
		result.Progress[owner] = Progress{}
	}
	candidate := ""
	blocked := false
	uncertain := map[string]bool{}
	earlierUncertain := map[string]bool{}
	for _, submission := range submissions {
		progress, exists := result.Progress[submission.Owner]
		if !exists {
			continue
		}
		progress.State = submission.State
		if submission.State == "completed" && submission.Score != nil {
			progress.BestPassed = max(progress.BestPassed, submission.Score.Passed)
			if submission.Verdict == "accepted" && submission.Score.Passed == submission.Score.Total && candidate == "" {
				candidate = submission.Owner
			}
		} else {
			uncertain[submission.Owner] = true
			if candidate == "" {
				earlierUncertain[submission.Owner] = true
				blocked = true
			}
		}
		result.Progress[submission.Owner] = progress
	}
	winner, high, draw := "", -1, false
	for owner, progress := range result.Progress {
		if progress.BestPassed > high {
			winner, high, draw = owner, progress.BestPassed, false
		} else if progress.BestPassed == high {
			draw = true
		}
	}
	// The sole leader's unresolved work cannot lower their existing best score.
	if candidate == "" && !now.Before(deadline) && !draw {
		blocked = false
		for owner := range uncertain {
			if owner != winner {
				blocked = true
			}
		}
	}
	// Earlier work by the same owner cannot change the winning owner.
	if candidate != "" {
		blocked = false
		for owner := range earlierUncertain {
			if owner != candidate {
				blocked = true
			}
		}
	}
	if candidate != "" && !blocked {
		result.Outcome = &Outcome{Kind: "win", WinnerUserID: candidate, Reason: "first_correct"}
	} else if !now.Before(deadline) || candidate != "" || finalizing != nil {
		if result.FinalizingAt == nil {
			at := now
			if !now.Before(deadline) {
				at = deadline
			}
			result.FinalizingAt = &at
		}
		if blocked {
			if !now.Before(result.FinalizingAt.Add(2 * time.Minute)) {
				result.Outcome = &Outcome{Kind: "no_contest", Reason: "unresolved_eligible_work"}
			}
		} else {
			kind := "win"
			if draw {
				kind = "draw"
				winner = ""
			}
			result.Outcome = &Outcome{Kind: kind, WinnerUserID: winner, Reason: "deadline_score"}
		}
	}
	return result
}
