package postgres

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func validateCustomInterviewStages(f *problems.Fixture, c *interviews.CustomQuestion) error {
	if c.Odyssey == nil {
		return fmt.Errorf("Staged tests require stage definitions")
	}
	if len(c.PrivateCases) != 0 {
		return fmt.Errorf("Put private staged tests in their stage suites")
	}
	f.Problem.Odyssey = c.Odyssey
	f.OdysseyHiddenCases = c.OdysseyHiddenCases
	content := problems.QuestionContent{Problem: f.Problem, OdysseyHiddenCases: f.OdysseyHiddenCases, Attribution: f.Attribution}
	if err := problems.ValidateQuestionDefinition(content, false); err != nil {
		return err
	}
	primary, first := f.Problem.Signature, c.Odyssey.Levels[0].Methods[0]
	if primary.Parameters == nil {
		primary.Parameters = []problems.Parameter{}
	}
	if first.Parameters == nil {
		first.Parameters = []problems.Parameter{}
	}
	primaryJSON, _ := json.Marshal(primary)
	firstJSON, _ := json.Marshal(first)
	if !bytes.Equal(primaryJSON, firstJSON) {
		return fmt.Errorf("Primary signature must match the first stage method")
	}
	if len(c.PublicCases) == 0 || len(c.PublicCases) > 20 {
		return fmt.Errorf("Provide 1-20 public tests")
	}
	firstProblem, _, err := problems.CompileOdyssey(*f, 1, "run")
	if err != nil {
		return err
	}
	validator := problems.NewCaseValidator(firstProblem)
	for _, test := range c.PublicCases {
		if err = validator.Validate(test, true); err != nil {
			return fmt.Errorf("First-stage public test: %w", err)
		}
	}
	// Stages own their examples and cumulative judge suites; no catalog publication or reference code.
	f.Problem.Examples = append([]problems.ProblemExample{}, c.Odyssey.Levels[0].Examples...)
	return nil
}
