package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
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
	people := map[string]matches.Progress{}
	owners := []string{}
	rows, err := tx.Query(ctx, "SELECT owner_id,COALESCE(submission_state,''),best_passed FROM match_participants WHERE match_id=$1 AND NOT forfeited", m.id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var owner string
		var p matches.Progress
		if err = rows.Scan(&owner, &p.State, &p.BestPassed); err != nil {
			rows.Close()
			return err
		}
		people[owner] = p
		owners = append(owners, owner)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	submissions := []matches.SubmissionProgress{}
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
		if _, exists := people[owner]; !exists {
			continue
		}
		var result judging.Submission
		if len(resultData) > 0 {
			if err = json.Unmarshal(resultData, &result); err != nil {
				rows.Close()
				return err
			}
		}
		submissions = append(submissions, matches.SubmissionProgress{Owner: owner, State: state, Verdict: result.Verdict, Score: result.Score})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	decision := matches.Reconcile(now, *m.deadline, m.finalizing, owners, submissions)
	changed := false
	for owner, p := range decision.Progress {
		if people[owner] != p {
			changed = true
			if _, err = tx.Exec(ctx, "UPDATE match_participants SET best_passed=$3,submission_state=NULLIF($4,'') WHERE match_id=$1 AND owner_id=$2", m.id, owner, p.BestPassed, p.State); err != nil {
				return err
			}
		}
	}
	if m.finalizing == nil && decision.FinalizingAt != nil {
		m.finalizing = decision.FinalizingAt
		m.state = "finalizing"
		if _, err = tx.Exec(ctx, "UPDATE matches SET state='finalizing',finalizing_at=$2 WHERE id=$1", m.id, m.finalizing); err != nil {
			return err
		}
		changed = true
	}
	if outcome := decision.Outcome; outcome != nil {
		if err = finishMatch(ctx, tx, m, outcome.Kind, outcome.WinnerUserID, outcome.Reason); err != nil {
			return err
		}
		changed = true
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
