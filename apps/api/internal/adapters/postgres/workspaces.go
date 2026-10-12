package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/workspace"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateWorkspace(ctx context.Context, owner, problemID, language string) (workspace.Workspace, error) {
	if language != "python" {
		return workspace.Workspace{}, failure("invalid_input", 400, "Only Python is supported")
	}
	p, err := s.Problem(ctx, problemID, true)
	if err != nil {
		return workspace.Workspace{}, err
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
