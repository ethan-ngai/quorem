package postgres

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func customStagedInterviewQuestion() interviews.QuestionInput {
	put := problems.Signature{ClassName: "Solution", MethodName: "put", Parameters: []problems.Parameter{{Name: "amount", Type: "int"}}, ReturnType: "void"}
	total := problems.Signature{ClassName: "Solution", MethodName: "total", Parameters: []problems.Parameter{}, ReturnType: "int"}
	take := problems.Signature{ClassName: "Solution", MethodName: "take", Parameters: []problems.Parameter{{Name: "amount", Type: "int"}}, ReturnType: "bool"}
	first := problems.Case{Args: []json.RawMessage{}, Calls: []problems.MethodCall{{MethodName: "put", Args: []json.RawMessage{json.RawMessage(`3`)}, Expected: json.RawMessage(`null`)}, {MethodName: "total", Args: []json.RawMessage{}, Expected: json.RawMessage(`3`)}}}
	second := problems.Case{Args: []json.RawMessage{}, Calls: []problems.MethodCall{{MethodName: "put", Args: []json.RawMessage{json.RawMessage(`8`)}, Expected: json.RawMessage(`null`)}, {MethodName: "take", Args: []json.RawMessage{json.RawMessage(`2`)}, Expected: json.RawMessage(`true`)}, {MethodName: "total", Args: []json.RawMessage{}, Expected: json.RawMessage(`6`)}}}
	return interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Private staged counter", StatementMarkdown: "Build the counter across stages.", Signature: put, StarterSource: "class Solution:\n    def __init__(self): self.value = 0\n    def put(self, amount): self.value += amount\n    def total(self): return self.value\n", PublicCases: []problems.Case{first}, PrivateCases: []problems.Case{}, Odyssey: &problems.Odyssey{Levels: []problems.OdysseyLevel{{Title: "Accumulate", StatementMarkdown: "Implement put and total.", Methods: []problems.Signature{put, total}, Examples: []problems.ProblemExample{{Case: first}}}, {Title: "Withdraw", StatementMarkdown: "Add take without breaking previous methods.", Methods: []problems.Signature{take}, Examples: []problems.ProblemExample{{Case: second}}}}}, OdysseyHiddenCases: [][]problems.Case{{first}, {second}}}}
}
func cloneCustomStaged(q interviews.QuestionInput) interviews.QuestionInput {
	data, _ := json.Marshal(q)
	var clone interviews.QuestionInput
	_ = json.Unmarshal(data, &clone)
	return clone
}
func TestPrivateCustomStagesValidateWithoutPublication(t *testing.T) {
	q := customStagedInterviewQuestion()
	f, err := (&Store{}).interviewQuestion(context.Background(), "", q)
	if err != nil {
		t.Fatal(err)
	}
	if f.ReferenceSource != "" || len(f.OdysseyHiddenCases) != 2 || len(f.Problem.Languages) != 4 || f.Problem.StarterSource == q.Custom.StarterSource {
		t.Fatal("private staged fixture", f)
	}
	for _, impl := range f.Problem.Languages {
		if !strings.Contains(impl.StarterSource, "put") || !strings.Contains(impl.StarterSource, "total") || strings.Contains(impl.StarterSource, "take") {
			t.Fatal("first-stage methods", impl)
		}
		if impl.Language == "ocaml" && !strings.Contains(impl.StarterSource, "total ()") {
			t.Fatal("zero-argument OCaml function missing unit", impl)
		}
	}
	for level, want := range map[int]int{1: 1, 2: 2} {
		p, cases, err := problems.CompileOdyssey(f, level, "submit")
		if err != nil || len(cases) != want || len(p.Odyssey.Levels) != level {
			t.Fatal("cumulative suites", level, cases, err)
		}
	}
}
func TestPrivateCustomStagesRejectInvalidDefinitions(t *testing.T) {
	tests := map[string]func(*interviews.CustomQuestion){
		"missing definition": func(c *interviews.CustomQuestion) { c.Odyssey = nil },
		"missing suites":     func(c *interviews.CustomQuestion) { c.OdysseyHiddenCases = nil },
		"zero stages":        func(c *interviews.CustomQuestion) { c.Odyssey.Levels = nil },
		"too many stages": func(c *interviews.CustomQuestion) {
			for len(c.Odyssey.Levels) < 9 {
				c.Odyssey.Levels = append(c.Odyssey.Levels, c.Odyssey.Levels[0])
			}
		},
		"mismatched suites":   func(c *interviews.CustomQuestion) { c.OdysseyHiddenCases = c.OdysseyHiddenCases[:1] },
		"duplicate method":    func(c *interviews.CustomQuestion) { c.Odyssey.Levels[1].Methods[0].MethodName = "put" },
		"wrong class":         func(c *interviews.CustomQuestion) { c.Odyssey.Levels[1].Methods[0].ClassName = "Other" },
		"primary mismatch":    func(c *interviews.CustomQuestion) { c.Signature.MethodName = "wrong" },
		"empty private suite": func(c *interviews.CustomQuestion) { c.OdysseyHiddenCases[1] = nil },
		"too many private cases": func(c *interviews.CustomQuestion) {
			for len(c.OdysseyHiddenCases[0]) < 21 {
				c.OdysseyHiddenCases[0] = append(c.OdysseyHiddenCases[0], c.OdysseyHiddenCases[0][0])
			}
		},
		"missing examples": func(c *interviews.CustomQuestion) { c.Odyssey.Levels[0].Examples = nil },
		"future call":      func(c *interviews.CustomQuestion) { c.OdysseyHiddenCases[0][0].Calls[0].MethodName = "take" },
		"wrong arguments":  func(c *interviews.CustomQuestion) { c.OdysseyHiddenCases[0][0].Calls[0].Args = nil },
		"wrong return value": func(c *interviews.CustomQuestion) {
			c.OdysseyHiddenCases[0][0].Calls[1].Expected = json.RawMessage(`true`)
		},
		"bad parameter type": func(c *interviews.CustomQuestion) { c.Odyssey.Levels[1].Methods[0].Parameters[0].Type = "void" },
		"long parameter name": func(c *interviews.CustomQuestion) {
			c.Odyssey.Levels[1].Methods[0].Parameters[0].Name = strings.Repeat("x", 81)
		},
		"mixed legacy cases":   func(c *interviews.CustomQuestion) { c.PrivateCases = c.PublicCases },
		"future public sample": func(c *interviews.CustomQuestion) { c.PublicCases = c.OdysseyHiddenCases[1] },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			q := cloneCustomStaged(customStagedInterviewQuestion())
			change(q.Custom)
			if _, err := (&Store{}).interviewQuestion(context.Background(), "", q); errorCode(err) != "invalid_input" {
				t.Fatal("invalid stage accepted", err)
			}
		})
	}
}
func TestPrivateCustomStagesCreationCumulativeJudgingAndLanguageDrafts(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	q := customStagedInterviewQuestion()
	starter, err := problems.GenerateStarter(q.Custom.Odyssey.Levels[0].Methods, q.Language, true)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Custom stages", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	if v.Question.Progress.Level != 1 || v.Question.Progress.TotalLevels != 2 || len(v.Question.PrivateCaseDetails) != 2 || v.Document.Source != starter {
		t.Fatal("staged creation", v)
	}
	candidate, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", "")
	if err != nil || len(candidate.Question.Progress.Levels) != 1 || len(candidate.Question.PrivateCaseDetails) != 0 {
		t.Fatal("candidate future/private projection", candidate, err)
	}
	var catalog int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM problem_versions WHERE slug='interview-private'`).Scan(&catalog); err != nil || catalog != 0 {
		t.Fatal("private stages published", catalog, err)
	}
	submit := func(total, passed int) {
		t.Helper()
		if _, err = s.Pool.Exec(ctx, `UPDATE users SET admission_tokens=2 WHERE id='bob'`); err != nil {
			t.Fatal(err)
		}
		sub, e := s.AdmitInterview(ctx, "bob", v.ID, ID(), "submit", nil)
		if e != nil {
			t.Fatal(e)
		}
		job, e := s.Claim(ctx)
		if e != nil || job.SubmissionID != sub.ID {
			t.Fatal(job, e)
		}
		spec, e := s.LoadExecution(ctx, job)
		if e != nil || len(spec.Cases) != total || spec.Source != starter {
			t.Fatal("immutable source/cumulative cases", spec, e)
		}
		finishInterviewJob(t, s, job, passed, total)
	}
	submit(1, 1)
	progress, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || progress.Question.Progress.Level != 2 || progress.Document.Source != starter {
		t.Fatal("automatic stage/source preservation", progress, err)
	}
	submit(2, 1)
	progress, err = s.Interview(ctx, "bob", v.ID)
	if err != nil || progress.Question.Progress.Completed {
		t.Fatal("regression completed stages", progress, err)
	}
	submit(2, 2)
	progress, err = s.Interview(ctx, "bob", v.ID)
	if err != nil || !progress.Question.Progress.Completed {
		t.Fatal("cumulative completion", progress, err)
	}
	switched, err := s.SwitchInterviewLanguage(ctx, "bob", v.ID, ID(), "java", progress.Document.Epoch)
	if err != nil || !strings.Contains(switched.Document.Source, "public void put") || !strings.Contains(switched.Document.Source, "public int total") || strings.Contains(switched.Document.Source, "take") || !switched.Question.Progress.Completed {
		t.Fatal("staged alternate language starter/progress", switched, err)
	}
	restored, err := s.SwitchInterviewLanguage(ctx, "alice", v.ID, ID(), "python", switched.Document.Epoch)
	if err != nil || restored.Document.Source != starter {
		t.Fatal("authored draft lost", restored, err)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), q); err != nil {
		t.Fatal("edit staged question", err)
	}
	reset, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || reset.Question.Progress.Level != 1 || reset.Question.Progress.Completed {
		t.Fatal("replacement retained old progress", reset, err)
	}
}

func TestPrivateCustomStageStartersCompileInSupportedRuntimes(t *testing.T) {
	if os.Getenv("QUOREM_TEST_DOCKER") != "1" {
		t.Skip("QUOREM_TEST_DOCKER=1 enables trusted starter compiler checks")
	}
	q := customStagedInterviewQuestion()
	f, err := (&Store{}).interviewQuestion(context.Background(), "", q)
	if err != nil {
		t.Fatal(err)
	}
	commands := map[string]string{
		"python":     "python -c 'import ast,sys; ast.parse(sys.stdin.read())'",
		"java":       "cat >/tmp/Solution.java && javac -J-Xmx128m -d /tmp /tmp/Solution.java",
		"typescript": "cat >/tmp/solution.ts && tsc --target ES2020 --module commonjs /tmp/solution.ts",
		"ocaml":      "cat >/tmp/solution.ml && ocamlc -c -o /tmp/solution.cmo /tmp/solution.ml",
	}
	for _, impl := range f.Problem.Languages {
		t.Run(impl.Language, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, "docker", "run", "--rm", "-i", "--network", "none", "--memory", "256m", "--pids-limit", "64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--entrypoint", "sh", "quorem-"+impl.Language+":local", "-c", commands[impl.Language])
			command.Stdin = strings.NewReader(impl.StarterSource)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("%s starter did not compile: %v\n%s\n%s", impl.Language, err, output, impl.StarterSource)
			}
		})
	}
}

func TestPrivateCustomStagesIgnoreVoidExpectations(t *testing.T) {
	for _, expected := range []json.RawMessage{nil, json.RawMessage(`1`), json.RawMessage(`null`)} {
		q := cloneCustomStaged(customStagedInterviewQuestion())
		q.Custom.OdysseyHiddenCases[0][0].Calls[0].Expected = expected
		if _, err := (&Store{}).interviewQuestion(context.Background(), "", q); err != nil {
			t.Fatal("void expectation rejected", err)
		}
	}
}
