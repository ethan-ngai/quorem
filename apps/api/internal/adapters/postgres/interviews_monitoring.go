package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/jackc/pgx/v5"
)

func (s *Store) SetInterviewMonitoring(ctx context.Context, user, id, key string, policy interviews.Monitoring) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "monitoring", policy, func(tx pgx.Tx, v interviewRecord) error {
		if user != v.snapshot.HostID {
			return failure("forbidden", 403, "Only the host can change interview monitoring")
		}
		data, err := json.Marshal(policy)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE interviews SET monitoring=$2 WHERE id=$1`, id, data)
		return err
	})
}

// Observe only the authenticated interviewee; no clipboard contents enter this path.
func (s *Store) ReportInterviewRule(ctx context.Context, user, id, key, kind string) error {
	if kind != "paste" && kind != "focus" {
		return failure("invalid_input", 400, "Invalid interview event")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, true)
	if err != nil {
		return err
	}
	if v.snapshot.Role != "interviewee" {
		return failure("forbidden", 403, "Only interviewees report monitoring events")
	}
	hash := interviewFingerprint(id+":rule-event", kind)
	prior, _, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return err
	}
	if prior != "" {
		return nil
	}
	enabled := v.snapshot.Monitoring.PasteEnabled()
	if kind == "focus" {
		enabled = v.snapshot.Monitoring.FocusEnabled()
	}
	var recent bool
	if enabled {
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM interview_rule_events WHERE session_id=$1 AND owner_id=$2 AND kind=$3 AND occurred_at>clock_timestamp()-interval '2 seconds')`, id, user, kind).Scan(&recent)
		if err != nil {
			return err
		}
	}
	if enabled && !recent {
		if _, err = tx.Exec(ctx, `INSERT INTO interview_rule_events(id,session_id,owner_id,kind) VALUES($1,$2,$3,$4)`, ID(), id, user, kind); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM interview_rule_events WHERE session_id=$1 AND id NOT IN(SELECT id FROM interview_rule_events WHERE session_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 100)`, id); err != nil {
			return err
		}
		// The session update commits its existing transactional realtime notice with the event.
		if _, err = tx.Exec(ctx, `UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id); err != nil {
			return err
		}
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
