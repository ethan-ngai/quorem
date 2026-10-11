package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/jackc/pgx/v5"
	"time"
)

// The aggregate lock serializes admission, verdicts, deadlines, and concessions.
func (s *Store) reconcileMatch(ctx context.Context, tx pgx.Tx, m *matchRecord) error {
	if m.outcome != nil {
		return nil
	}
	var now time.Time
	if err := tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return err
	}
	if m.started == nil {
		if !now.Before(m.expires) {
			if err := finishMatch(ctx, tx, m, "cancelled", "", "invite_expired"); err != nil {
				return err
			}
			return matchEvent(ctx, tx, m)
		}
		return nil
	}
	type progress struct {
		owner, state string
		best         int
	}
	people := map[string]*progress{}
	rows, err := tx.Query(ctx, "SELECT owner_id,COALESCE(submission_state,''),best_passed FROM match_participants WHERE match_id=$1", m.id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p progress
		if err = rows.Scan(&p.owner, &p.state, &p.best); err != nil {
			rows.Close()
			return err
		}
		people[p.owner] = &p
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	best := map[string]int{}
	latest := map[string]string{}
	var candidateOwner string
	blocked := false
	uncertainOwners := map[string]bool{}
	rows, err = tx.Query(ctx, "SELECT owner_id,state,match_sequence,result FROM submissions WHERE match_id=$1 AND kind='submit' ORDER BY admitted_at,match_sequence", m.id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var owner, state string
		var sequence int64
		var resultData []byte
		if err = rows.Scan(&owner, &state, &sequence, &resultData); err != nil {
			rows.Close()
			return err
		}
		latest[owner] = state
		var result judging.Submission
		if len(resultData) > 0 {
			if err = json.Unmarshal(resultData, &result); err != nil {
				rows.Close()
				return err
			}
		}
		if state == "completed" && result.Score != nil {
			if result.Score.Passed > best[owner] {
				best[owner] = result.Score.Passed
			}
			if result.Verdict == "accepted" && result.Score.Passed == result.Score.Total && candidateOwner == "" {
				candidateOwner = owner
			}
		} else {
			uncertainOwners[owner] = true
			if candidateOwner == "" {
				blocked = true
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	changed := false
	for owner, p := range people {
		if p.best != best[owner] || p.state != latest[owner] {
			changed = true
			if _, err = tx.Exec(ctx, "UPDATE match_participants SET best_passed=$3,submission_state=NULLIF($4,'') WHERE match_id=$1 AND owner_id=$2", m.id, owner, best[owner], latest[owner]); err != nil {
				return err
			}
		}
	}
	winner := ""
	high := -1
	draw := false
	for owner := range people {
		score := best[owner]
		if score > high {
			high = score
			winner = owner
			draw = false
		} else if score == high {
			draw = true
		}
	}
	// An unresolved job from the sole leader cannot lower their best score.
	if candidateOwner == "" && !now.Before(*m.deadline) && !draw {
		blocked = false
		for owner := range uncertainOwners {
			if owner != winner {
				blocked = true
			}
		}
	}
	if candidateOwner != "" && !blocked {
		if err = finishMatch(ctx, tx, m, "win", candidateOwner, "first_correct"); err != nil {
			return err
		}
		changed = true
	} else if !now.Before(*m.deadline) || candidateOwner != "" {
		if m.finalizing == nil {
			// Deadline finalization begins at the persisted deadline, even after a restart.
			at := now
			if !now.Before(*m.deadline) {
				at = *m.deadline
			}
			m.finalizing = &at
			m.state = "finalizing"
			if _, err = tx.Exec(ctx, "UPDATE matches SET state='finalizing',finalizing_at=$2 WHERE id=$1", m.id, at); err != nil {
				return err
			}
			changed = true
		}
		if blocked {
			if !now.Before(m.finalizing.Add(2 * time.Minute)) {
				if err = finishMatch(ctx, tx, m, "no_contest", "", "unresolved_eligible_work"); err != nil {
					return err
				}
				changed = true
			}
		} else {
			kind := "win"
			if draw {
				kind = "draw"
				winner = ""
			}
			if err = finishMatch(ctx, tx, m, kind, winner, "deadline_score"); err != nil {
				return err
			}
			changed = true
		}
	}
	if changed {
		return matchEvent(ctx, tx, m)
	}
	return nil
}
func (s *Store) ReconcileMatches(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT id FROM matches WHERE state NOT IN ('completed','cancelled') ORDER BY reconciled_at,id FOR UPDATE SKIP LOCKED LIMIT 64")
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		m, e := lockMatch(ctx, tx, id)
		if e != nil {
			return e
		}
		if e = s.reconcileMatch(ctx, tx, &m); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "UPDATE matches SET reconciled_at=clock_timestamp() WHERE id=$1", id); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
