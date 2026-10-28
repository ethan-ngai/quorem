package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
	"os"
	"path/filepath"
)

type Parameter struct {
	Description string       `json:"description,omitempty"`
	Name        string       `json:"name"`
	Type        string       `json:"type"`
	Input       *InputConfig `json:"input,omitempty"`
}
type MethodException struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}
type Signature struct {
	Description string            `json:"description,omitempty"`
	Returns     string            `json:"returns,omitempty"`
	Throws      []MethodException `json:"throws,omitempty"`
	OutputOrder string            `json:"outputOrder,omitempty"`
	ClassName   string            `json:"className"`
	MethodName  string            `json:"methodName"`
	Parameters  []Parameter       `json:"parameters"`
	ReturnType  string            `json:"returnType"`
}
type MethodCall struct {
	MethodName string            `json:"methodName"`
	Args       []json.RawMessage `json:"args"`
	Expected   json.RawMessage   `json:"expected,omitempty"`
}
type Case struct {
	Calls    []MethodCall      `json:"calls,omitempty"`
	Args     []json.RawMessage `json:"args"`
	Expected json.RawMessage   `json:"expected,omitempty"`
}
type ProblemExample struct {
	Case
	Explanation string `json:"explanation,omitempty"`
}

func (p Problem) SampleCases() []Case {
	if p.Odyssey != nil {
		var cases []Case
		for _, level := range p.Odyssey.Levels {
			for _, example := range level.Examples {
				cases = append(cases, example.Case)
			}
		}
		return cases
	}
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

type OdysseyLevel struct {
	Title             string           `json:"title"`
	StatementMarkdown string           `json:"statementMarkdown"`
	Methods           []Signature      `json:"methods"`
	Examples          []ProblemExample `json:"examples"`
}
type Odyssey struct {
	Levels []OdysseyLevel `json:"levels"`
}
type OdysseyProgress struct {
	CaseStatuses []execution.PublicCaseResult `json:"caseStatuses,omitempty"`
	TotalLevels  int                          `json:"totalLevels"`
	Level        int                          `json:"level"`
	Completed    bool                         `json:"completed"`
	Levels       []OdysseyLevel               `json:"levels"`
}
type Problem struct {
	IsPrivate           bool                     `json:"isPrivate,omitempty"`
	SQL                 *SQLConfig               `json:"sql,omitempty"`
	ComplexityLanguages []string                 `json:"complexityLanguages,omitempty"`
	SolutionLanguages   []string                 `json:"solutionLanguages,omitempty"`
	Odyssey             *Odyssey                 `json:"odyssey,omitempty"`
	Languages           []LanguageImplementation `json:"languages"`
	ID                  string                   `json:"id"`
	Slug                string                   `json:"slug"`
	Version             string                   `json:"version"`
	Title               string                   `json:"title"`
	Difficulty          string                   `json:"difficulty"`
	Tags                []string                 `json:"tags"`
	Companies           []string                 `json:"companies"`
	LeetcodeID          *int                     `json:"leetcodeId,omitempty"`
	StatementMarkdown   string                   `json:"statementMarkdown"`
	Examples            []ProblemExample         `json:"examples"`
	Constraints         []Constraint             `json:"constraints"`
	Signature           Signature                `json:"signature"`
	StarterSource       string                   `json:"starterSource"`
	RuntimeRevision     string                   `json:"runtimeRevision"`
	Limits              execution.Limits         `json:"limits"`
}
type Fixture struct {
	OdysseyHiddenCases [][]Case `json:"odysseyHiddenCases,omitempty"`
	Problem            Problem  `json:"problem"`
	HarnessRevision    string   `json:"harnessRevision"`
	Attribution        string   `json:"attribution"`
	HiddenCases        []Case   `json:"hiddenCases"`
	ReferenceSource    string   `json:"referenceSource"`
}

type SeedFixture struct {
	Fixture
	Implementations []AuthoringImplementation
}

func LoadFixtures(dir string) ([]SeedFixture, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no question fixtures in %s", dir)
	}
	fixtures := make([]SeedFixture, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var content QuestionContent
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&content); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if decoder.Decode(new(any)) != io.EOF {
			return nil, fmt.Errorf("%s: trailing JSON", path)
		}
		if err = ValidateQuestionPublication(content); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		fixture, err := content.Fixture()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		fixtures = append(fixtures, SeedFixture{Fixture: fixture, Implementations: content.Implementations})
	}
	return fixtures, nil
}
