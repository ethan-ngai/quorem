package problems

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/ethan-ngai/quorem/internal/execution"
)

const AuthoringBodyLimit = 2 * 1024 * 1024

type AuthoringImplementation struct {
	LanguageImplementation
	ReferenceSource string `json:"referenceSource"`
}
type QuestionContent struct {
	OdysseyHiddenCases [][]Case                  `json:"odysseyHiddenCases,omitempty"`
	Problem            Problem                   `json:"problem"`
	HiddenCases        []Case                    `json:"hiddenCases"`
	Comparator         string                    `json:"comparator"`
	Attribution        string                    `json:"attribution"`
	Implementations    []AuthoringImplementation `json:"implementations"`
	Solutions          []EditorialSolution       `json:"solutions"`
}

var questionSlug = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
var symbolName = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Normalize omitted collections and compatibility metadata for complete draft response shapes.
func NormalizeQuestionDraft(c QuestionContent) QuestionContent {
	p := &c.Problem
	if p.ID == "" {
		p.ID = "00000000-0000-4000-8000-000000000000"
	}
	if p.Version == "" {
		p.Version = "0"
	}
	if p.Difficulty == "" {
		p.Difficulty = "easy"
	}
	if p.Signature.ClassName == "" {
		p.Signature.ClassName = "Solution"
	}
	if p.Limits == (execution.Limits{}) {
		p.Limits = execution.DefaultLimits()
	}
	if p.Tags == nil {
		p.Tags = []string{}
	}
	if p.Languages == nil {
		p.Languages = []LanguageImplementation{}
	}
	if p.Examples == nil {
		p.Examples = []ProblemExample{}
	}
	if p.Constraints == nil {
		p.Constraints = []Constraint{}
	}
	if p.Signature.Parameters == nil {
		p.Signature.Parameters = []Parameter{}
	}
	if c.HiddenCases == nil {
		c.HiddenCases = []Case{}
	}
	if c.Implementations == nil {
		c.Implementations = []AuthoringImplementation{}
	}
	if c.Solutions == nil {
		c.Solutions = []EditorialSolution{}
	}
	for i := range p.Examples {
		if p.Examples[i].Args == nil {
			p.Examples[i].Args = []json.RawMessage{}
		}
	}
	for i := range c.HiddenCases {
		if c.HiddenCases[i].Args == nil {
			c.HiddenCases[i].Args = []json.RawMessage{}
		}
	}
	return c
}

// Drafts may be incomplete; all saved content remains bounded and valid UTF-8.
func ValidateQuestionDraft(c QuestionContent) error {
	data, err := json.Marshal(c)
	if err != nil || len(data) > AuthoringBodyLimit {
		return fmt.Errorf("question content exceeds 2 MiB")
	}
	if !utf8.Valid(data) {
		return fmt.Errorf("invalid UTF-8")
	}
	p := c.Problem
	if len(p.Languages) > 4 || len(p.Tags) > 32 || len(p.Examples) > 20 || len(p.Constraints) > 64 || len(c.HiddenCases) > 20 || len(c.Implementations) > 4 || len(c.Solutions) > 4 || len(p.Signature.Parameters) > 16 {
		return fmt.Errorf("question collection limit exceeded")
	}
	if len(p.ID) > 64 || len(p.Version) > 32 || len(p.StarterSource) > 65536 || len(p.RuntimeRevision) > 128 || len(p.Slug) > 80 || len(p.Title) > 160 || len(p.StatementMarkdown) > 65536 || len(c.Attribution) > 2048 {
		return fmt.Errorf("question text limit exceeded")
	}
	for _, example := range p.Examples {
		if len(example.Explanation) > 8192 {
			return fmt.Errorf("example explanation limit exceeded")
		}
	}
	for _, constraint := range p.Constraints {
		if len(constraint.Text) > 4096 {
			return fmt.Errorf("constraint text limit exceeded")
		}
	}
	for _, language := range p.Languages {
		if len(language.StarterSource) > 65536 {
			return fmt.Errorf("language source limit exceeded")
		}
	}
	for _, v := range c.Implementations {
		if len(v.StarterSource) > 65536 || len(v.ReferenceSource) > 65536 || len(v.RuntimeRevision) > 128 || len(v.HarnessRevision) > 128 {
			return fmt.Errorf("language source limit exceeded")
		}
	}
	for _, v := range c.Solutions {
		if len(v.Source) > 65536 || len(v.ExplanationMarkdown) > 65536 || len(v.TimeComplexity) > 256 || len(v.SpaceComplexity) > 256 || len(v.ComplexityNotes) > 4096 {
			return fmt.Errorf("editorial text limit exceeded")
		}
	}
	return nil
}

// Publication validates metadata and wire cases; compilation/reference acceptance is a separate gate.
func ValidateQuestionPublication(c QuestionContent) error {
	if err := ValidateQuestionDraft(c); err != nil {
		return err
	}
	p := c.Problem
	if p.Odyssey != nil {
		if err := ValidateOdyssey(c); err != nil {
			return err
		}
	}
	if !questionSlug.MatchString(p.Slug) || strings.TrimSpace(p.Title) == "" || strings.TrimSpace(p.StatementMarkdown) == "" {
		return fmt.Errorf("slug, title and statement required")
	}
	if p.Difficulty != "easy" && p.Difficulty != "medium" && p.Difficulty != "hard" {
		return fmt.Errorf("invalid difficulty")
	}
	if c.Comparator != "ordered" {
		return fmt.Errorf("only ordered comparison is supported")
	}
	if strings.TrimSpace(c.Attribution) == "" {
		return fmt.Errorf("attribution required")
	}
	if p.Odyssey == nil && (len(p.Examples) == 0 || len(c.HiddenCases) != 20) {
		return fmt.Errorf("public examples and exactly 20 hidden cases required")
	}
	seenTags := map[string]bool{}
	for _, tag := range p.Tags {
		if strings.TrimSpace(tag) == "" || len(tag) > 64 || seenTags[tag] {
			return fmt.Errorf("invalid or duplicate tag")
		}
		seenTags[tag] = true
	}
	sig := p.Signature
	if sig.ClassName != "Solution" || !symbolName.MatchString(sig.MethodName) || len(sig.MethodName) > 80 {
		return fmt.Errorf("Solution class and valid method name required")
	}
	seenParameters := map[string]bool{}
	for _, param := range sig.Parameters {
		if !symbolName.MatchString(param.Name) || len(param.Name) > 80 || seenParameters[param.Name] {
			return fmt.Errorf("invalid or duplicate parameter")
		}
		seenParameters[param.Name] = true
		if err := ValidateInputConfig(param.Type, param.Input); err != nil {
			return err
		}
	}
	if err := ValidateInputConfig(sig.ReturnType, nil); err != nil && !(p.Odyssey != nil && sig.ReturnType == "void") {
		return err
	}
	if err := ValidateConstraints(sig, p.Constraints); err != nil {
		return err
	}
	limits, max := p.Limits, execution.DefaultLimits()
	if limits.WallTimeMS < 1 || limits.WallTimeMS > max.WallTimeMS || limits.MemoryBytes < 1 || limits.MemoryBytes > max.MemoryBytes || limits.OutputBytes < 1 || limits.OutputBytes > max.OutputBytes || limits.MaxProcesses < 1 || limits.MaxProcesses > max.MaxProcesses || limits.MaxCollectionElements < 1 || limits.MaxCollectionElements > max.MaxCollectionElements || limits.MaxNestingDepth < 1 || limits.MaxNestingDepth > max.MaxNestingDepth {
		return fmt.Errorf("execution limits exceed supported bounds")
	}
	for _, example := range p.Examples {
		if err := ValidateProblemCase(p, example.Case, true); err != nil {
			return fmt.Errorf("example: %w", err)
		}
	}
	for i, test := range c.HiddenCases {
		if err := ValidateProblemCase(p, test, true); err != nil {
			return fmt.Errorf("hidden case %d: %w", i+1, err)
		}
	}
	languages := map[string]bool{}
	for _, v := range c.Implementations {
		runtime, ok := execution.LanguageRuntime(v.Language)
		if !ok || languages[v.Language] || runtime.Revision != v.RuntimeRevision || runtime.Harness != v.HarnessRevision || strings.TrimSpace(v.StarterSource) == "" || strings.TrimSpace(v.ReferenceSource) == "" {
			return fmt.Errorf("invalid or duplicate language implementation")
		}
		languages[v.Language] = true
	}
	if !languages["python"] {
		return fmt.Errorf("Python implementation required for compatibility")
	}
	editorials := map[string]bool{}
	for _, v := range c.Solutions {
		if !languages[v.Language] || editorials[v.Language] || strings.TrimSpace(v.Source) == "" || strings.TrimSpace(v.ExplanationMarkdown) == "" || strings.TrimSpace(v.TimeComplexity) == "" || strings.TrimSpace(v.SpaceComplexity) == "" || strings.TrimSpace(v.ComplexityNotes) == "" {
			return fmt.Errorf("editorial code, explanation, complexity and variable definitions required")
		}
		editorials[v.Language] = true
	}
	return nil
}
