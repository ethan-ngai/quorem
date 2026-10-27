package execution

import (
	"context"
	_ "embed"
	"encoding/json"
)

const HarnessRevision = "quorem-harness-v2"
const RuntimeRevision = "python-3.12-v1"

const MaxInputElements = 100000
const MaxCustomCasesBytes = 2 << 20

//go:embed public/quorem_types.py
var PublicPythonDeclarations string

type Limits struct {
	WallTimeMS            int   `json:"wallTimeMs"`
	MemoryBytes           int64 `json:"memoryBytes"`
	OutputBytes           int   `json:"outputBytes"`
	MaxProcesses          int   `json:"maxProcesses"`
	MaxCollectionElements int   `json:"maxCollectionElements"`
	MaxNestingDepth       int   `json:"maxNestingDepth"`
}

func DefaultLimits() Limits {
	return Limits{WallTimeMS: 2000, MemoryBytes: 256 * 1024 * 1024, OutputBytes: 64 * 1024, MaxProcesses: 16, MaxCollectionElements: 10000, MaxNestingDepth: 100}
}

type Job struct {
	Language         string `json:"language"`
	JobID            string `json:"jobId"`
	SubmissionID     string `json:"submissionId"`
	AttemptID        string `json:"attemptId"`
	ProblemVersionID string `json:"problemVersionId"`
	RuntimeRevision  string `json:"runtimeRevision"`
	HarnessRevision  string `json:"harnessRevision"`
	SourceRef        string `json:"sourceRef"`
	SuiteRef         string `json:"suiteRef"`
	Limits           Limits `json:"limits"`
}

type Verdict string

const (
	Accepted      Verdict = "accepted"
	WrongAnswer   Verdict = "wrong_answer"
	SyntaxError   Verdict = "syntax_error"
	RuntimeError  Verdict = "runtime_error"
	TimeLimit     Verdict = "time_limit"
	MemoryLimit   Verdict = "memory_limit"
	OutputLimit   Verdict = "output_limit"
	InvalidOutput Verdict = "invalid_output"
)

type Score struct {
	Passed int `json:"passed"`
	Total  int `json:"total"`
}

type Diagnostic struct {
	Message string `json:"message"`
	Line    int    `json:"line,omitempty"`
	Column  int    `json:"column,omitempty"`
}

type PublicCaseResult struct {
	SQLTypes    []string        `json:"sqlTypes,omitempty"`
	Stdout      string          `json:"stdout,omitempty"`
	Stderr      string          `json:"stderr,omitempty"`
	Index       int             `json:"index"`
	Status      string          `json:"status"`
	Actual      json.RawMessage `json:"actual,omitempty"`
	Expected    json.RawMessage `json:"expected,omitempty"`
	Diagnostics []Diagnostic    `json:"diagnostics,omitempty"`
}

// HiddenCaseResult exposes only the outcome, never hidden inputs or execution output.
type HiddenCaseResult struct {
	Index  int     `json:"index"`
	Status Verdict `json:"status"`
}

type Completion struct {
	SubmitSampleResults []PublicCaseResult `json:"submitSampleResults,omitempty"`
	PrivateCaseResults  []PublicCaseResult `json:"privateCaseResults,omitempty"`
	SubmissionID        string             `json:"submissionId"`
	AttemptID           string             `json:"attemptId"`
	Verdict             Verdict            `json:"verdict,omitempty"`
	Score               *Score             `json:"score,omitempty"`
	SafeDiagnostics     []Diagnostic       `json:"safeDiagnostics,omitempty"`
	PublicCaseResults   []PublicCaseResult `json:"publicCaseResults,omitempty"`
	HiddenCases         []HiddenCaseResult `json:"hiddenCases,omitempty"`
	EngineFailure       string             `json:"engineFailure,omitempty"`
}

// ExecutionEngine hides runtime and queue providers from application rules.
type ExecutionEngine interface {
	Execute(context.Context, Job) (Completion, error)
}
