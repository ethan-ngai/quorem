package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestForkStagedQuestionRemovesOnlyDuplicateExamples(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	for _, distinct := range []bool{false, true} {
		fixture, err := s.interviewQuestion(ctx, "alice", customStagedInterviewQuestion())
		if err != nil {
			t.Fatal(err)
		}
		fixture.Problem.Examples = append([]problems.ProblemExample{}, fixture.Problem.Odyssey.Levels[0].Examples...)
		if distinct {
			fixture.Problem.Examples[0].Explanation = "Different example metadata"
		}
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err = saveInterviewCustomQuestion(ctx, tx, "alice", fixture); err != nil {
			tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		content, err := s.QuestionContent(ctx, fixture.Problem.ID)
		if err != nil {
			t.Fatal(err)
		}
		if distinct {
			if len(content.Problem.Examples) != 1 || content.Problem.Examples[0].Explanation != "Different example metadata" || problems.ValidateQuestionPublication(content) == nil {
				t.Fatal("distinct ignored data was lost or silently published", content.Problem.Examples)
			}
		} else if len(content.Problem.Examples) != 0 || problems.ValidateQuestionPublication(content) != nil {
			t.Fatal("duplicate staged examples blocked fork", content.Problem.Examples)
		}
	}
}
