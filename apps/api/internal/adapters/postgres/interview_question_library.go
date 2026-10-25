package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// Save the same immutable question privately; retries share the interview transaction.
func saveInterviewCustomQuestion(ctx context.Context, tx pgx.Tx, owner string, f problems.Fixture) error {
	f.Problem.Slug = "private-" + f.Problem.ID
	f.Problem.Version = "1"
	if f.ReferenceSource == "" {
		f.ReferenceSource = "Private question uses explicit expected values"
	}
	if len(f.HiddenCases) == 0 && f.Problem.Odyssey == nil {
		for _, e := range f.Problem.Examples {
			f.HiddenCases = append(f.HiddenCases, e.Case)
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO problems(slug,owner_id) VALUES($1,$2)`, f.Problem.Slug, owner); err != nil {
		return err
	}
	public, err := json.Marshal(f.Problem)
	if err != nil {
		return err
	}
	private, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO problem_versions(id,slug,version,public,fixture) VALUES($1,$2,1,$3,$4)`, f.Problem.ID, f.Problem.Slug, public, private); err != nil {
		return err
	}
	for _, impl := range f.Problem.Languages {
		if impl.Language == "python" {
			continue
		}
		if _, err = tx.Exec(ctx, `INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,$2,$3,$4,$5,$6)`, f.Problem.ID, impl.Language, impl.StarterSource, impl.RuntimeRevision, impl.HarnessRevision, f.ReferenceSource); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE problem_versions SET sealed=true WHERE id=$1`, f.Problem.ID)
	return err
}
