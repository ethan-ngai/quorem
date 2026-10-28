package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/internal/execution"
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
	rows, err = tx.Query(ctx, `SELECT s.owner_id,s.state,s.match_sequence,COALESCE(s.result->>'verdict',''),s.result->'score',COALESCE(s.odyssey_level < jsonb_array_length(p.odyssey->'levels'),false),CASE WHEN c.definite_failures>0 AND c.definite_failures<=c.next_ordinal AND c.definite_failures<=jsonb_array_length(s.cases) THEN jsonb_array_length(s.cases)-c.definite_failures END FROM submissions s JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN execution_jobs j ON j.submission_id=s.id LEFT JOIN execution_checkpoints c ON c.job_id=j.id WHERE s.match_id=$1 AND s.kind='submit' ORDER BY s.admitted_at,s.match_sequence`, m.id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var owner, state, verdict string
		var sequence int64
		var scoreData []byte
		var intermediate bool
		var maxPossible *int
		if err = rows.Scan(&owner, &state, &sequence, &verdict, &scoreData, &intermediate, &maxPossible); err != nil {
			rows.Close()
			return err
		}
		if _, exists := people[owner]; !exists {
			continue
		}
		var score *execution.Score
		if len(scoreData) > 0 {
			if err = json.Unmarshal(scoreData, &score); err != nil {
				rows.Close()
				return err
			}
		}
		submissions = append(submissions, matches.SubmissionProgress{Owner: owner, State: state, Verdict: execution.Verdict(verdict), Score: score, Intermediate: intermediate, MaxPossible: maxPossible, CannotPass: maxPossible != nil})
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
	_, err := s.reconcileMatches(ctx, false)
	return err
}

// Due work is locked by the same aggregate transaction as commands and verdicts.
func (s *Store) ReconcileDueMatches(ctx context.Context) (int, error) {
	return s.reconcileMatches(ctx, true)
}

const matchDue = `CASE WHEN started_at IS NULL THEN expires_at WHEN finalizing_at IS NOT NULL THEN finalizing_at + interval '2 minutes' ELSE deadline END`
const matchPending = `EXISTS (SELECT 1 FROM match_reconciliation_pending pending WHERE pending.match_id=matches.id)`

func (s *Store) reconcileMatches(ctx context.Context, dueOnly bool) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	query := "SELECT id, (SELECT generation FROM match_reconciliation_pending pending WHERE pending.match_id=matches.id) FROM matches WHERE "
	if dueOnly {
		query += "((state NOT IN ('completed','cancelled') AND " + matchDue + " <= clock_timestamp()) OR " + matchPending + ") ORDER BY " + matchDue + ",id"
	} else {
		query += "state NOT IN ('completed','cancelled') ORDER BY reconciled_at,id"
	}
	rows, err := tx.Query(ctx, query+" FOR UPDATE SKIP LOCKED LIMIT 64")
	if err != nil {
		return 0, err
	}
	type pendingMatch struct {
		id         string
		generation *int64
	}
	ids := []pendingMatch{}
	for rows.Next() {
		var item pendingMatch
		if err = rows.Scan(&item.id, &item.generation); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	for _, item := range ids {
		m, e := lockMatch(ctx, tx, item.id)
		if e != nil {
			return 0, e
		}
		if e = s.reconcileMatch(ctx, tx, &m); e != nil {
			return 0, e
		}
		if _, e = tx.Exec(ctx, "UPDATE matches SET reconciled_at=clock_timestamp() WHERE id=$1", item.id); e != nil {
			return 0, e
		}
		if dueOnly && item.generation != nil {
			if _, e = tx.Exec(ctx, "DELETE FROM match_reconciliation_pending WHERE match_id=$1 AND generation=$2", item.id, *item.generation); e != nil {
				return 0, e
			}
		}
	}
	return len(ids), tx.Commit(ctx)
}
