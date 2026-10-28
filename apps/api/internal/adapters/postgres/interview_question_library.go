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
	f.Problem.Examples = append([]problems.ProblemExample{}, f.Problem.Examples...)
	f.HiddenCases = append([]problems.Case{}, f.HiddenCases...)
	// The primary implementation supplies the shared fixture's runtime.
	for _, impl := range f.Problem.Languages {
		if impl.Language == "python" {
			f.Problem.StarterSource = impl.StarterSource
			f.Problem.RuntimeRevision = impl.RuntimeRevision
			f.HarnessRevision = impl.HarnessRevision
		}
	}
	for i := range f.Problem.Examples {
		if len(f.Problem.Examples[i].Expected) == 0 {
			f.Problem.Examples[i].Expected = json.RawMessage("null")
		}
	}
	for i := range f.HiddenCases {
		if len(f.HiddenCases[i].Expected) == 0 {
			f.HiddenCases[i].Expected = json.RawMessage("null")
		}
	}
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
	inserted, err := insertProblemVersion(ctx, tx, f)
	if err != nil {
		return err
	}
	if !inserted {
		return failure("revision_conflict", 409, "Problem version already exists")
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
