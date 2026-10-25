package postgres

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

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
	content := problems.QuestionContent{Problem: f.Problem, OdysseyHiddenCases: f.OdysseyHiddenCases}
	if err := problems.ValidateQuestionDraft(content); err != nil {
		return err
	}
	if strings.TrimSpace(f.Problem.Title) == "" || strings.TrimSpace(f.Problem.StatementMarkdown) == "" {
		return fmt.Errorf("Title and statement required")
	}
	if err := problems.ValidateOdyssey(content); err != nil {
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
	for _, test := range c.PublicCases {
		if err = problems.ValidateOdysseyCase(firstProblem, test, true); err != nil {
			return fmt.Errorf("First-stage public test: %w", err)
		}
	}
	// Stages own their examples and cumulative judge suites; no catalog publication or reference code.
	f.Problem.Examples = append([]problems.ProblemExample{}, c.Odyssey.Levels[0].Examples...)
	return nil
}

func interviewStageStarter(methods []problems.Signature, language string) (string, error) {
	if language == "python" {
		var source strings.Builder
		source.WriteString("class Solution:\n    def __init__(self):\n        pass\n\n")
		for _, sig := range methods {
			args := []string{"self"}
			for _, p := range sig.Parameters {
				args = append(args, p.Name)
			}
			source.WriteString("    def " + sig.MethodName + "(" + strings.Join(args, ", ") + "):\n        raise NotImplementedError\n\n")
		}
		return source.String(), nil
	}
	bodies := make([]string, 0, len(methods))
	for _, sig := range methods {
		source, err := problems.Starter(sig, language)
		if err != nil {
			return "", err
		}
		if language == "ocaml" {
			if len(sig.Parameters) == 0 {
				source = strings.Replace(source, "let "+sig.MethodName+"  :", "let "+sig.MethodName+" () :", 1)
			}
			bodies = append(bodies, source)
			continue
		}
		marker := "class " + sig.ClassName + " {\n"
		offset := strings.Index(source, marker)
		if offset < 0 {
			return "", fmt.Errorf("Unsupported stage starter")
		}
		bodies = append(bodies, strings.TrimSuffix(source[offset+len(marker):], "}\n"))
	}
	if language == "ocaml" {
		return strings.Join(bodies, "\n"), nil
	}
	constructor := "    public Solution() {\n    }\n\n"
	if language == "typescript" {
		constructor = "    constructor() {\n    }\n\n"
	}
	return "class Solution {\n" + constructor + strings.Join(bodies, "\n") + "}\n", nil
}
