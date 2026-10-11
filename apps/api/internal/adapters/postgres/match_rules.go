package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/jackc/pgx/v5"
	"time"
)

func validateMatchProblem(ctx context.Context, tx pgx.Tx, settings matches.Settings) error {
	if settings.SelectedProblemVersionID == "" {
		return nil
	}
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problem_versions WHERE id::text=$1)", settings.SelectedProblemVersionID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return failure("invalid_input", 400, "Problem not found")
	}
	return nil
}
func (s *Store) ReportMatchRule(ctx context.Context, owner, id, key, kind string) (matches.Snapshot, error) {
	if kind != "clipboard" && kind != "focus" {
		return matches.Snapshot{}, failure("invalid_input", 400, "Invalid rule event")
	}
	return s.mutateMatch(ctx, owner, id, key, "rule-events", kind, func(tx pgx.Tx, m *matchRecord) error {
		if m.state != "active" {
			return failure("invalid_transition", 409, "Match is not active")
		}
		action := m.settings.Rules.Clipboard
		if kind == "focus" {
			action = m.settings.Rules.Focus
		}
		var forfeited bool
		var last *time.Time
		var now time.Time
		if err := tx.QueryRow(ctx, "SELECT forfeited,last_rule_event_at,clock_timestamp() FROM match_participants WHERE match_id=$1 AND owner_id=$2", id, owner).Scan(&forfeited, &last, &now); err != nil {
			return err
		}
		if forfeited {
			return failure("invalid_transition", 409, "Participant forfeited")
		}
		if action == "off" || action == "warning" || last != nil && now.Sub(*last) < 2*time.Second {
			m.suppressEvent = true
			return nil
		}
		if _, err := tx.Exec(ctx, "UPDATE match_participants SET last_rule_event_at=$3 WHERE match_id=$1 AND owner_id=$2", id, owner, now); err != nil {
			return err
		}
		if action == "cooldown" {
			_, err := tx.Exec(ctx, "UPDATE match_participants SET cooldown_until=$3+interval '30 seconds' WHERE match_id=$1 AND owner_id=$2 AND (cooldown_until IS NULL OR cooldown_until<=$3)", id, owner, now)
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO match_rule_events(id,match_id,owner_id,kind,occurred_at) VALUES($1,$2,$3,$4,$5)", ID(), id, owner, kind, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "DELETE FROM match_rule_events WHERE match_id=$1 AND id NOT IN (SELECT id FROM match_rule_events WHERE match_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20)", id)
		return err
	})
}
