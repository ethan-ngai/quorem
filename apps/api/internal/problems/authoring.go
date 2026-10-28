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
const MaxHiddenCases = 100

type AuthoringImplementation struct {
	LanguageImplementation
	ReferenceSource string `json:"referenceSource"`
}
type QuestionContent struct {
	OdysseyHiddenCases [][]Case                  `json:"odysseyHiddenCases,omitempty"`
	Problem            Problem                   `json:"problem"`
	HiddenCases        []Case                    `json:"hiddenCases"`
	Attribution        string                    `json:"attribution"`
	Implementations    []AuthoringImplementation `json:"implementations"`
	Solutions          []EditorialSolution       `json:"solutions"`
}

// Fixture projects authored implementations into the immutable runtime representation.
func (c QuestionContent) Fixture() (Fixture, error) {
	p := c.Problem
	p.Languages = make([]LanguageImplementation, 0, len(c.Implementations))
	primaryLanguage := "python"
	if p.SQL != nil {
		primaryLanguage = "postgresql"
	}
	fixture := Fixture{Problem: p, HiddenCases: c.HiddenCases, OdysseyHiddenCases: c.OdysseyHiddenCases, Attribution: c.Attribution}
	found := false
	for _, impl := range c.Implementations {
		fixture.Problem.Languages = append(fixture.Problem.Languages, impl.LanguageImplementation)
		if impl.Language == primaryLanguage {
			if found {
				return Fixture{}, fmt.Errorf("duplicate primary implementation")
			}
			found = true
			fixture.Problem.StarterSource = impl.StarterSource
			fixture.Problem.RuntimeRevision = impl.RuntimeRevision
			fixture.HarnessRevision = impl.HarnessRevision
			fixture.ReferenceSource = impl.ReferenceSource
		}
	}
	if !found {
		return Fixture{}, fmt.Errorf("primary implementation missing")
	}
	return fixture, nil
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
	if p.Companies == nil {
		p.Companies = []string{}
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
		normalizeDraftCase(&p.Examples[i].Case)
	}
	for i := range c.HiddenCases {
		normalizeDraftCase(&c.HiddenCases[i])
	}
	if p.Odyssey != nil {
		if p.Odyssey.Levels == nil {
			p.Odyssey.Levels = []OdysseyLevel{}
		}
		for i := range p.Odyssey.Levels {
			level := &p.Odyssey.Levels[i]
			if level.Methods == nil {
				level.Methods = []Signature{}
			}
			if level.Examples == nil {
				level.Examples = []ProblemExample{}
			}
			for j := range level.Methods {
				if level.Methods[j].Parameters == nil {
					level.Methods[j].Parameters = []Parameter{}
				}
			}
			for j := range level.Examples {
				normalizeDraftCase(&level.Examples[j].Case)
			}
		}
	}
	for i := range c.OdysseyHiddenCases {
		if c.OdysseyHiddenCases[i] == nil {
			c.OdysseyHiddenCases[i] = []Case{}
		}
		for j := range c.OdysseyHiddenCases[i] {
			normalizeDraftCase(&c.OdysseyHiddenCases[i][j])
		}
	}
	return c
}

func normalizeDraftCase(c *Case) {
	if c.Args == nil {
		c.Args = []json.RawMessage{}
	}
	for i := range c.Calls {
		if c.Calls[i].Args == nil {
			c.Calls[i].Args = []json.RawMessage{}
		}
	}
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
	if len(p.Languages) > 4 || len(p.Tags) > 32 || len(p.Companies) > 64 || len(p.Examples) > 20 || len(p.Constraints) > 64 || len(c.HiddenCases) > MaxHiddenCases || len(c.Implementations) > 4 || len(c.Solutions) > 4 || len(p.Signature.Parameters) > 16 {
		return fmt.Errorf("question collection limit exceeded")
	}
	if len(p.ID) > 64 || len(p.Version) > 32 || len(p.StarterSource) > 65536 || len(p.RuntimeRevision) > 128 || len(p.Slug) > 80 || len(p.Title) > 160 || len(p.StatementMarkdown) > 65536 || len(c.Attribution) > 2048 {
		return fmt.Errorf("question text limit exceeded")
	}
	if p.LeetcodeID != nil && (*p.LeetcodeID < 1 || *p.LeetcodeID > 2147483647) {
		return fmt.Errorf("invalid LeetCode ID")
	}
	seenCompanies := map[string]bool{}
	for _, company := range p.Companies {
		key := strings.ToLower(company)
		if company != strings.TrimSpace(company) || company == "" || len(company) > 80 || strings.Contains(company, ",") || seenCompanies[key] {
			return fmt.Errorf("invalid or duplicate company")
		}
		seenCompanies[key] = true
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

// ValidateQuestionDefinition checks shared metadata and cases before publication or interview use.
func ValidateQuestionDefinition(c QuestionContent, requireHidden bool) error {
	if err := ValidateQuestionDraft(c); err != nil {
		return err
	}
	p := c.Problem
	if p.Odyssey != nil && p.SQL == nil {
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
	if strings.TrimSpace(c.Attribution) == "" {
		return fmt.Errorf("attribution required")
	}
	if p.Odyssey == nil && (len(p.Examples) == 0 || (requireHidden && len(c.HiddenCases) == 0)) {
		return fmt.Errorf("public examples and at least one hidden case required")
	}
	seenTags := map[string]bool{}
	for _, tag := range p.Tags {
		if strings.TrimSpace(tag) == "" || len(tag) > 64 || seenTags[tag] {
			return fmt.Errorf("invalid or duplicate tag")
		}
		seenTags[tag] = true
	}
	if p.SQL == nil {
		sig := p.Signature
		if err := validateSignature(sig, p.Odyssey != nil); err != nil {
			return err
		}
		if err := ValidateConstraints(sig, p.Constraints); err != nil {
			return err
		}
	} else if err := validateSQLPublication(c); err != nil {
		return err
	}
	limits, max := p.Limits, execution.DefaultLimits()
	if p.SQL != nil && (limits.MemoryBytes < max.MemoryBytes || limits.MaxProcesses < max.MaxProcesses) {
		return fmt.Errorf("PostgreSQL requires the default memory and process limits")
	}
	if limits.WallTimeMS < 1 || limits.WallTimeMS > max.WallTimeMS || limits.MemoryBytes < 1 || limits.MemoryBytes > max.MemoryBytes || limits.OutputBytes < 1 || limits.OutputBytes > max.OutputBytes || limits.MaxProcesses < 1 || limits.MaxProcesses > max.MaxProcesses || limits.MaxCollectionElements < 1 || limits.MaxCollectionElements > execution.MaxInputElements || limits.MaxNestingDepth < 1 || limits.MaxNestingDepth > max.MaxNestingDepth {
		return fmt.Errorf("execution limits exceed supported bounds")
	}
	validator := NewCaseValidator(p)
	for _, example := range p.Examples {
		if err := validator.Validate(example.Case, true); err != nil {
			return fmt.Errorf("example: %w", err)
		}
	}
	for i, test := range c.HiddenCases {
		if err := validator.Validate(test, true); err != nil {
			return fmt.Errorf("hidden case %d: %w", i+1, err)
		}
	}
	return nil
}

func validateSignature(sig Signature, allowVoid bool) error {
	if !validOutputOrder(sig) || sig.ClassName != "Solution" || !symbolName.MatchString(sig.MethodName) || len(sig.MethodName) > 80 || len(sig.Parameters) > 16 {
		return fmt.Errorf("Solution class and valid method name required")
	}
	seen := map[string]bool{}
	for _, param := range sig.Parameters {
		if !symbolName.MatchString(param.Name) || len(param.Name) > 80 || seen[param.Name] {
			return fmt.Errorf("invalid or duplicate parameter")
		}
		seen[param.Name] = true
		if err := ValidateInputConfig(param.Type, param.Input); err != nil {
			return err
		}
	}
	if allowVoid && sig.ReturnType == "void" {
		return nil
	}
	return ValidateInputConfig(sig.ReturnType, nil)
}

// Publication additionally requires pinned implementations and private references.
func ValidateQuestionPublication(c QuestionContent) error {
	if err := ValidateQuestionDefinition(c, true); err != nil {
		return err
	}
	p := c.Problem
	languages := map[string]bool{}
	for _, v := range c.Implementations {
		runtime, ok := execution.LanguageRuntime(v.Language)
		if !ok || languages[v.Language] || runtime.Revision != v.RuntimeRevision || runtime.Harness != v.HarnessRevision || strings.TrimSpace(v.StarterSource) == "" || strings.TrimSpace(v.ReferenceSource) == "" {
			return fmt.Errorf("invalid or duplicate language implementation")
		}
		languages[v.Language] = true
	}
	if p.SQL == nil && (!languages["python"] || languages["postgresql"]) {
		return fmt.Errorf("Python implementation required for coding problems")
	}
	if p.SQL != nil && (len(languages) != 1 || !languages["postgresql"]) {
		return fmt.Errorf("SQL problems require the PostgreSQL implementation")
	}
	editorials := map[string]bool{}
	for _, v := range c.Solutions {
		if !languages[v.Language] || editorials[v.Language] || strings.TrimSpace(v.Source) == "" {
			return fmt.Errorf("editorial language and code required")
		}
		editorials[v.Language] = true
	}
	return nil
}
