package problems

import (
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"path/filepath"
)

type Parameter struct {
	Name string `json:"name"`
	Type string `json:"type"`
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
type Problem struct {
	ID                string           `json:"id"`
	Slug              string           `json:"slug"`
	Version           string           `json:"version"`
	Title             string           `json:"title"`
	Difficulty        string           `json:"difficulty"`
	Tags              []string         `json:"tags"`
	StatementMarkdown string           `json:"statementMarkdown"`
	Examples          []Case           `json:"examples"`
	Constraints       []string         `json:"constraints"`
	Signature         Signature        `json:"signature"`
	StarterSource     string           `json:"starterSource"`
	RuntimeRevision   string           `json:"runtimeRevision"`
	Limits            execution.Limits `json:"limits"`
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
		for _, c := range append(append([]Case{}, f.Problem.Examples...), f.HiddenCases...) {
			if e = ValidateCase(f.Problem.Signature, c, true); e != nil {
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
