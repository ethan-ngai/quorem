package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

// Initial authored editorials are append-only; restarting cannot replace published content.
func (s *Store) SeedEditorials(ctx context.Context, dir string) error {
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var seed struct {
			Slug      string                       `json:"slug"`
			Solutions []problems.EditorialSolution `json:"solutions"`
		}
		if err = json.Unmarshal(data, &seed); err != nil {
			return fmt.Errorf("editorial %s: %w", path, err)
		}
		p, err := s.Problem(ctx, seed.Slug, false)
		if err != nil {
			return err
		}
		for _, v := range seed.Solutions {
			if v.Source == "" || v.ExplanationMarkdown == "" || v.TimeComplexity == "" || v.SpaceComplexity == "" {
				return fmt.Errorf("incomplete editorial %s", path)
			}
			_, err = s.Pool.Exec(ctx, `INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, p.ID, v.Language, v.Source, v.ExplanationMarkdown, v.TimeComplexity, v.SpaceComplexity, v.ComplexityNotes)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
