package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestSealedProblemRejectsChildMutationAndUnsealing(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	v := p.Languages[0]
	var reference string
	if err = s.Pool.QueryRow(ctx, "SELECT reference_source FROM problem_languages WHERE version_id=$1 AND language='python'", p.ID).Scan(&reference); err != nil {
		t.Fatal(err)
	}
	editorial := problems.EditorialSolution{Language: "python", Source: "authored", ExplanationMarkdown: "Explain", TimeComplexity: "O(n)", SpaceComplexity: "O(n)"}
	if err = s.SaveSolutions(ctx, p.ID, []problems.EditorialSolution{editorial}); err != nil {
		t.Fatal(err)
	}
	if err = s.SealProblemVersions(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.SealProblemVersions(ctx); err != nil {
		t.Fatal("seal replay", err)
	}
	if err = s.RegisterImplementations(ctx, p.ID, []problems.LanguageImplementation{v}, map[string]string{"python": reference}); err != nil {
		t.Fatal("identical language replay", err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO problem_solutions SELECT * FROM problem_solutions WHERE version_id=$1 ON CONFLICT DO NOTHING`, p.ID); err != nil {
		t.Fatal("identical editorial replay", err)
	}
	mutations := []string{
		"UPDATE problem_versions SET sealed=false WHERE id=$1",
		"UPDATE problem_versions SET title='changed',sealed=true WHERE id=$1",
		"DELETE FROM problem_versions WHERE id=$1",
		"INSERT INTO problem_languages VALUES($1,'java','source','runtime','harness','reference')",
		"DELETE FROM problem_languages WHERE version_id=$1",
		"INSERT INTO problem_examples VALUES($1,99,'[]','null','new')",
		"DELETE FROM problem_examples WHERE version_id=$1",
		"INSERT INTO problem_test_cases VALUES($1,99,'[]','null')",
		"DELETE FROM problem_test_cases WHERE version_id=$1",
		"INSERT INTO problem_tags VALUES($1,'new-tag',99)",
		"DELETE FROM problem_tags WHERE version_id=$1",
		"UPDATE problem_solutions SET source='changed' WHERE version_id=$1",
		"DELETE FROM problem_solutions WHERE version_id=$1",
	}
	for _, query := range mutations {
		if _, err = s.Pool.Exec(ctx, query, p.ID); err == nil {
			t.Fatalf("sealed mutation accepted: %s", query)
		}
	}
	// Sealing old publications also forbids first-time editorial addition.
	other, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveSolutions(ctx, other.ID, []problems.EditorialSolution{editorial}); err == nil {
		t.Fatal("late editorial accepted")
	}
}

func TestPublicationTransactionRollsBackAllContent(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	id := ID()
	if _, err = tx.Exec(ctx, `INSERT INTO problem_versions(id,slug,version,public,fixture) SELECT $1,slug,version+1,public || jsonb_build_object('id',$1::uuid::text,'version',(version+1)::text),fixture FROM problem_versions WHERE id=$2`, id, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO problem_languages VALUES($1,'java','source','runtime','harness','reference')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "UPDATE problem_versions SET sealed=true WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	current, err := s.Problem(ctx, p.Slug, false)
	if err != nil || current.ID != p.ID {
		t.Fatal("partial publication", current.ID, err)
	}
	var exists bool
	if err = s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problem_versions WHERE id=$1)", id).Scan(&exists); err != nil || exists {
		t.Fatal("partial version persisted", err)
	}
}
