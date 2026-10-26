package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"net/http/httptest"
	"strings"
	"testing"
)

type hintsRepository struct {
	Repository
	allowed bool
}

func (r *hintsRepository) HasActiveMatchProblem(context.Context, string, string) (bool, error) {
	return true, nil
}
func (r *hintsRepository) ActiveMatch(context.Context, string) (*matches.Snapshot, error) {
	return &matches.Snapshot{ProblemVersionID: "00000000-0000-4000-8000-000000000000", Settings: matches.Settings{Rules: matches.Rules{Hints: &problems.HintVisibility{Complexity: &r.allowed}}}}, nil
}
func (r *hintsRepository) Solutions(context.Context, string) ([]problems.EditorialSolution, error) {
	return []problems.EditorialSolution{{Language: "python", Source: "SECRET_SOLUTION", TimeComplexity: "O(n)", SpaceComplexity: "O(1)"}, {Language: "java", Source: "ANOTHER_SECRET"}}, nil
}
func TestHostCanAllowComplexityWithoutAllowingSolutionCode(t *testing.T) {
	for _, allowed := range []bool{false, true} {
		for _, complexity := range []bool{false, true} {
			s := &Server{Store: &hintsRepository{allowed: allowed}}
			req := httptest.NewRequest("GET", "/", nil)
			req.SetPathValue("id", "00000000-0000-4000-8000-000000000000")
			rec := httptest.NewRecorder()
			if complexity {
				s.complexity(rec, req)
			} else {
				s.editorials(rec, req)
			}
			want := 403
			if allowed && complexity {
				want = 200
			}
			if rec.Code != want || strings.Contains(rec.Body.String(), "SECRET_SOLUTION") || strings.Contains(rec.Body.String(), "ANOTHER_SECRET") || strings.Contains(rec.Body.String(), `"java"`) {
				t.Fatalf("allowed %v complexity %v: %d %s", allowed, complexity, rec.Code, rec.Body.String())
			}
		}
	}
}
