package postgres

import (
	"context"
	"testing"
)

func TestEditorialSeedAppendOnlyAndSeparateFromPrivateReferences(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.SeedEditorials(ctx, "../../../../../fixtures/editorials"); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	solutions, err := s.Solutions(ctx, p.ID)
	if err != nil || len(solutions) != 4 {
		t.Fatal(solutions, err)
	}
	var reference string
	if err = s.Pool.QueryRow(ctx, "SELECT reference_source FROM problem_languages WHERE version_id=$1 AND language='python'", p.ID).Scan(&reference); err != nil {
		t.Fatal(err)
	}
	var pythonSource string
	for _, solution := range solutions {
		if solution.Language == "python" {
			pythonSource = solution.Source
		}
	}
	if reference == pythonSource {
		t.Fatal("editorial copied from private judge source")
	}
	if err = s.SeedEditorials(ctx, "../../../../../fixtures/editorials"); err != nil {
		t.Fatal(err)
	}
	again, err := s.Solutions(ctx, p.ID)
	if err != nil || len(again) != 4 || again[0] != solutions[0] {
		t.Fatal(again, err)
	}
}
