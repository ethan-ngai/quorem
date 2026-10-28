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
	Owner        string
	State        string
	Verdict      execution.Verdict
	Score        *execution.Score
	Intermediate bool
	// MaxPossible is a private upper bound from a fenced checkpoint.
	MaxPossible *int
	CannotPass  bool
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
	earlierUncertain := map[string]bool{}
	for _, submission := range submissions {
		progress, exists := result.Progress[submission.Owner]
		if !exists {
			continue
		}
		progress.State = submission.State
		if submission.State == "completed" && submission.Score != nil {
			progress.BestPassed = max(progress.BestPassed, submission.Score.Passed)
			if !submission.Intermediate && submission.Verdict == "accepted" && submission.Score.Passed == submission.Score.Total && candidate == "" {
				candidate = submission.Owner
			}
		} else {
			provenFailed := submission.CannotPass && submission.MaxPossible != nil && *submission.MaxPossible >= 0
			if candidate == "" && !submission.Intermediate && !provenFailed {
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
	// Incomplete work matters only if it can change the final winner or tie.
	if candidate == "" && !now.Before(deadline) {
		blocked = false
		for _, submission := range submissions {
			if _, exists := result.Progress[submission.Owner]; !exists || (submission.State == "completed" && submission.Score != nil) {
				continue
			}
			if !draw && submission.Owner == winner {
				continue
			}
			provenFailed := submission.CannotPass && submission.MaxPossible != nil && *submission.MaxPossible >= 0
			if !submission.Intermediate && !provenFailed {
				blocked = true
				continue
			}
			if !provenFailed || (draw && *submission.MaxPossible > high) || (!draw && *submission.MaxPossible >= high) {
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
