package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/workspace"
	"github.com/jackc/pgx/v5"
)

// Switching replaces only the participant's active pointer; each language keeps its own workspace.
func (s *Store) SwitchMatchLanguage(ctx context.Context, owner, matchID, key, language string) (workspace.Workspace, error) {
	var result workspace.Workspace
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", owner).Scan(&locked); err != nil {
		return result, err
	}
	route := "matches/" + matchID + "/workspace-language"
	var prior []byte
	var fingerprint string
	err = tx.QueryRow(ctx, "SELECT response,body_hash FROM match_idempotency WHERE owner_id=$1 AND route=$2 AND key=$3 AND expires_at>clock_timestamp()", owner, route, key).Scan(&prior, &fingerprint)
	if err == nil {
		if fingerprint != Hash([]byte(language)) {
			return result, failure("idempotency_conflict", 409, "Key was used for a different language")
		}
		err = json.Unmarshal(prior, &result)
		return result, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	m, err := lockMatch(ctx, tx, matchID)
	if err != nil {
		return result, err
	}
	var forfeited bool
	if err = tx.QueryRow(ctx, "SELECT forfeited FROM match_participants WHERE match_id=$1 AND owner_id=$2", matchID, owner).Scan(&forfeited); errors.Is(err, pgx.ErrNoRows) {
		return result, failure("not_found", 404, "Match not found")
	} else if err != nil {
		return result, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return result, err
	}
	if forfeited || m.state != "active" || m.deadline == nil || !now.Before(*m.deadline) {
		return result, failure("invalid_transition", 409, "Match language selection is closed")
	}
	var supported, busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problem_languages WHERE version_id=$1 AND language=$2)", m.problem, language).Scan(&supported); err != nil {
		return result, err
	}
	if !supported {
		return result, failure("invalid_input", 400, "Language is unavailable for this problem")
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=$1 AND state IN ('queued','running'))", owner).Scan(&busy); err != nil {
		return result, err
	}
	if busy {
		return result, failure("user_busy", 409, "Wait for the current execution before switching languages")
	}
	err = tx.QueryRow(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$2,$3,$4,'match',$5) ON CONFLICT(match_id,owner_id,language) WHERE kind='match' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id,kind,problem_version_id,language,match_id`, ID(), owner, m.problem, language, matchID).Scan(&result.ID, &result.Kind, &result.ProblemVersionID, &result.Language, &result.MatchID)
	if err != nil {
		return result, err
	}
	result.Preferences = map[string]any{"theme": "system", "codeFontSize": 14, "tabSize": 4, "wrap": false, "paneRatios": []float64{0.42, 0.58}}
	if _, err = tx.Exec(ctx, "UPDATE match_participants SET workspace_id=$3 WHERE match_id=$1 AND owner_id=$2", matchID, owner, result.ID); err != nil {
		return result, err
	}
	if err = matchEvent(ctx, tx, &m); err != nil {
		return result, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,route,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`, owner, route, key, Hash([]byte(language)), encoded); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
