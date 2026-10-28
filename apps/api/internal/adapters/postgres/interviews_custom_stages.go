package postgres

import (
	"fmt"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func validateCustomInterviewStages(f *problems.Fixture, c *interviews.CustomQuestion) error {
	if c.Odyssey == nil {
		return fmt.Errorf("Staged tests require stage definitions")
	}
	if c.PublicCases != nil || c.PrivateCases != nil {
		return fmt.Errorf("Put staged examples and tests in their stages")
	}
	f.Problem.Odyssey = c.Odyssey
	f.OdysseyHiddenCases = c.OdysseyHiddenCases
	content := problems.QuestionContent{Problem: f.Problem.QuestionDefinition, OdysseyHiddenCases: f.OdysseyHiddenCases, Attribution: f.Attribution}
	if err := problems.ValidateQuestionDefinition(content, false); err != nil {
		return err
	}
	return nil
}
