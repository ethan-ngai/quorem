package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/workspace"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateWorkspace(ctx context.Context, owner, problemID, language string) (workspace.Workspace, error) {
	if _, ok := execution.LanguageRuntime(language); !ok {
		return workspace.Workspace{}, failure("invalid_input", 400, "Unsupported language")
	}
	p, err := s.Problem(ctx, problemID, true)
	if err != nil {
		return workspace.Workspace{}, err
	}
	if p.Odyssey != nil {
		c, e := s.Capabilities(ctx, owner)
		if e != nil {
			return workspace.Workspace{}, e
		}
		if !c.Odyssey {
			return workspace.Workspace{}, failure("entitlement_required", 403, "Odyssey access required")
		}
	}
	var supported bool
	if err = s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problem_languages WHERE version_id=$1 AND language=$2)", p.ID, language).Scan(&supported); err != nil {
		return workspace.Workspace{}, err
	}
	if !supported {
		return workspace.Workspace{}, failure("invalid_input", 400, "Language unavailable for this problem")
	}
	var id string
	err = s.Pool.QueryRow(ctx, "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,problem_version_id,language) WHERE kind='solo' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id", ID(), owner, p.ID, language).Scan(&id)
	if err != nil {
		return workspace.Workspace{}, err
	}
	return s.Workspace(ctx, owner, id)
}
func (s *Store) Workspace(ctx context.Context, owner, id string) (workspace.Workspace, error) {
	var w workspace.Workspace
	err := s.Pool.QueryRow(ctx, "SELECT id,kind,problem_version_id,language,COALESCE(match_id::text,'') FROM workspaces WHERE id::text=$1 AND owner_id=$2", id, owner).Scan(&w.ID, &w.Kind, &w.ProblemVersionID, &w.Language, &w.MatchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return w, failure("not_found", 404, "Workspace not found")
	}
	w.Preferences = map[string]any{"theme": "system", "codeFontSize": 14, "tabSize": 4, "wrap": false, "paneRatios": []float64{0.42, 0.58}}
	return w, err
}
