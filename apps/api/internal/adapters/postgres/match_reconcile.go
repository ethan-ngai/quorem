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
	var candidateSequence int64
	uncertain := []int64{}
	rows, err = tx.Query(ctx, "SELECT owner_id,state,match_sequence,result FROM submissions WHERE match_id=$1 AND kind='submit' ORDER BY match_sequence", m.id)
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
				candidateSequence = sequence
			}
		} else {
			uncertain = append(uncertain, sequence)
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
	blocked := false
	for _, seq := range uncertain {
		if candidateOwner == "" || seq < candidateSequence {
			blocked = true
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
	rows, err := s.Pool.Query(ctx, "SELECT id FROM matches WHERE state NOT IN ('completed','cancelled') ORDER BY id")
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
		tx, e := s.Pool.Begin(ctx)
		if e != nil {
			return e
		}
		m, e := lockMatch(ctx, tx, id)
		if e == nil {
			e = s.reconcileMatch(ctx, tx, &m)
		}
		if e == nil {
			e = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		if e != nil {
			return e
		}
	}
	return nil
}
