package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestNormalizedProblemContentAndEditorialIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.Languages) < 1 {
		t.Fatal(p, err)
	}
	payload, _ := json.Marshal(p)
	if strings.Contains(string(payload), "referenceSource") || strings.Contains(string(payload), "hiddenCases") {
		t.Fatal("private data in public projection")
	}
	empty, err := s.Solutions(ctx, p.ID)
	if err != nil || len(empty) != 0 {
		t.Fatal("reference exposed as editorial", empty, err)
	}
	authored := problems.EditorialSolution{Language: "python", Source: "editorial-only-marker", ExplanationMarkdown: "Group runs.", TimeComplexity: "O(n)", SpaceComplexity: "O(n)", ComplexityNotes: "n is input length; includes output."}
	if err = s.SaveSolutions(ctx, p.ID, []problems.EditorialSolution{authored}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Solutions(ctx, p.ID)
	if err != nil || len(got) != 1 || got[0] != authored {
		t.Fatal(got, err)
	}
	if errorCode(s.SaveSolutions(ctx, p.ID, nil)) != "immutable_version" {
		t.Fatal("editorial overwritten")
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE problem_versions SET title='changed' WHERE id=$1", p.ID); err == nil {
		t.Fatal("published version mutated")
	}
	var v problems.LanguageImplementation
	for _, language := range p.Languages {
		if language.Language == "python" {
			v = language
		}
	}
	if v.Language != "python" {
		t.Fatal("missing Python implementation")
	}
	if err = s.RegisterImplementations(ctx, p.ID, []problems.LanguageImplementation{v}, map[string]string{"python": "changed-reference"}); errorCode(err) != "immutable_version" {
		t.Fatal("language changed", err)
	}
	if _, err = s.Pool.Exec(ctx, "INSERT INTO problems(slug,current_version_id) VALUES('wrong-parent',$1)", p.ID); err == nil {
		t.Fatal("cross-problem publication accepted")
	}
}
