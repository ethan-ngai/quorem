package problems

import (
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"path/filepath"
)

type Parameter struct {
	Name  string       `json:"name"`
	Type  string       `json:"type"`
	Input *InputConfig `json:"input,omitempty"`
}
type Signature struct {
	ClassName  string      `json:"className"`
	MethodName string      `json:"methodName"`
	Parameters []Parameter `json:"parameters"`
	ReturnType string      `json:"returnType"`
}
type Case struct {
	Args     []json.RawMessage `json:"args"`
	Expected json.RawMessage   `json:"expected,omitempty"`
}
type ProblemExample struct {
	Case
	Explanation string `json:"explanation,omitempty"`
}

func (p Problem) SampleCases() []Case {
	cases := make([]Case, len(p.Examples))
	for i, example := range p.Examples {
		cases[i] = example.Case
	}
	return cases
}

type LanguageImplementation struct {
	Language        string `json:"language"`
	StarterSource   string `json:"starterSource"`
	RuntimeRevision string `json:"runtimeRevision"`
	HarnessRevision string `json:"harnessRevision"`
}

// Editorial content is authored separately from private judge references.
type EditorialSolution struct {
	Language            string `json:"language"`
	Source              string `json:"source"`
	ExplanationMarkdown string `json:"explanationMarkdown"`
	TimeComplexity      string `json:"timeComplexity"`
	SpaceComplexity     string `json:"spaceComplexity"`
	ComplexityNotes     string `json:"complexityNotes"`
}

type Problem struct {
	Languages         []LanguageImplementation `json:"languages"`
	ID                string                   `json:"id"`
	Slug              string                   `json:"slug"`
	Version           string                   `json:"version"`
	Title             string                   `json:"title"`
	Difficulty        string                   `json:"difficulty"`
	Tags              []string                 `json:"tags"`
	StatementMarkdown string                   `json:"statementMarkdown"`
	Examples          []ProblemExample         `json:"examples"`
	Constraints       []Constraint             `json:"constraints"`
	Signature         Signature                `json:"signature"`
	StarterSource     string                   `json:"starterSource"`
	RuntimeRevision   string                   `json:"runtimeRevision"`
	Limits            execution.Limits         `json:"limits"`
}
type Fixture struct {
	Problem         Problem `json:"problem"`
	HarnessRevision string  `json:"harnessRevision"`
	Comparator      string  `json:"comparator"`
	Attribution     string  `json:"attribution"`
	HiddenCases     []Case  `json:"hiddenCases"`
	ReferenceSource string  `json:"referenceSource"`
}

func LoadFixtures(dir string) ([]Fixture, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	var fixtures []Fixture
	for _, path := range paths {
		data, e := os.ReadFile(path)
		if e != nil {
			return nil, e
		}
		var f Fixture
		if e = json.Unmarshal(data, &f); e != nil {
			return nil, e
		}
		if len(f.HiddenCases) != 20 {
			return nil, fmt.Errorf("%s needs 20 cases", path)
		}
		if e = ValidateConstraints(f.Problem.Signature, f.Problem.Constraints); e != nil {
			return nil, fmt.Errorf("%s: %w", path, e)
		}
		for _, c := range append(append([]Case{}, f.Problem.SampleCases()...), f.HiddenCases...) {
			if e = ValidateProblemCase(f.Problem, c, true); e != nil {
				return nil, fmt.Errorf("%s: %w", path, e)
			}
		}
		fixtures = append(fixtures, f)
	}
	if len(fixtures) != 6 {
		return nil, fmt.Errorf("need six fixtures, found %d", len(fixtures))
	}
	return fixtures, nil
}
