package engine

import (
	"context"
	"crypto/rand"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"strings"
	"testing"
	"time"
)

func executeLanguage(t *testing.T, f worker.Fixture, language, source, kind string, cases []worker.Case) execution.Completion {
	t.Helper()
	runtime, ok := execution.LanguageRuntime(language)
	if !ok {
		t.Fatal(language)
	}
	docker := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: source, Kind: kind, Fixture: f, Cases: cases}, nil
	}}
	job := execution.Job{Language: language, JobID: "test", SubmissionID: "test", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()}
	// Compilation is bounded with contestant execution; its larger envelope is explicit.
	job.Limits.WallTimeMS = 2000
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	result, err := docker.Execute(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDockerLanguageCorpus(t *testing.T) {
	fixtures := dockerTests(t)
	for _, lang := range []string{"java", "typescript", "ocaml"} {
		for _, f := range fixtures {
			t.Run(lang+"/"+f.Problem.Slug, func(t *testing.T) {
				t.Parallel()
				source, err := os.ReadFile("../../../api/internal/problems/references/" + lang + "/" + f.Problem.Slug + ".txt")
				if err != nil {
					t.Fatal(err)
				}
				result := executeLanguage(t, f, lang, string(source), "submit", f.HiddenCases)
				if result.Verdict != execution.Accepted || result.Score == nil || result.Score.Passed != 20 || len(result.HiddenCases) != 20 {
					t.Fatal(result)
				}
				wrong := incorrectSource(f, lang)
				different := []worker.Case{}
				for _, c := range f.HiddenCases {
					if string(c.Expected) != "[]" && string(c.Expected) != "null" && string(c.Expected) != "0" && string(c.Expected) != "\"\"" {
						different = append(different, c)
						break
					}
				}
				failed := executeLanguage(t, f, lang, wrong, "run", different)
				if failed.Verdict != execution.WrongAnswer {
					t.Fatalf("incorrect reference accepted: %+v", failed)
				}
			})
		}
	}
}

func TestDockerLanguageFailures(t *testing.T) {
	f := dockerTests(t)[0]
	for _, test := range []struct{ language, wrong, loop, output string }{
		{"java", "class Solution {public int[] levelSpreads(TreeNode root){return new int[]{123};}}", "class Solution {public int[] levelSpreads(TreeNode root){while(true){}}}", "class Solution {public int[] levelSpreads(TreeNode root){System.out.print(\"x\".repeat(70000));return new int[0];}}"},
		{"typescript", "class Solution {levelSpreads(root:TreeNode|null):number[]{return [123];}}", "class Solution {levelSpreads(root:TreeNode|null):number[]{while(true){}}}", "class Solution {levelSpreads(root:TreeNode|null):number[]{console.log('x'.repeat(70000));return [];}}"},
		{"ocaml", "let levelSpreads (root:tree_node option) = [123]", "let levelSpreads (root:tree_node option) = while true do () done; []", "let levelSpreads (root:tree_node option) = print_string (String.make 70000 'x'); []"},
	} {
		t.Run(test.language, func(t *testing.T) {
			for _, tc := range []struct {
				source  string
				verdict execution.Verdict
			}{{test.wrong, execution.WrongAnswer}, {"invalid !!!", execution.SyntaxError}, {test.loop, execution.TimeLimit}, {test.output, execution.OutputLimit}} {
				result := executeLanguage(t, f, test.language, tc.source, "run", f.Problem.SampleCases()[:1])
				if result.Verdict != tc.verdict {
					t.Fatalf("want %s got %+v", tc.verdict, result)
				}
			}
		})
	}
}

func incorrectSource(f worker.Fixture, language string) string {
	signature := f.Problem.Signature
	types := map[string]string{"int": "int", "str": "String", "list<int>": "int[]", "ListNode": "ListNode", "TreeNode": "TreeNode"}
	javaValue := map[string]string{"int": "0", "str": "\"\"", "list<int>": "new int[0]", "ListNode": "null"}[signature.ReturnType]
	jsValue := map[string]string{"int": "0", "str": "\"\"", "list<int>": "[]", "ListNode": "null"}[signature.ReturnType]
	mlValue := map[string]string{"int": "0", "str": "\"\"", "list<int>": "[]", "ListNode": "None"}[signature.ReturnType]
	params := []string{}
	names := []string{}
	for _, p := range signature.Parameters {
		params = append(params, types[p.Type]+" "+p.Name)
		names = append(names, p.Name)
	}
	switch language {
	case "java":
		return "class Solution {public " + types[signature.ReturnType] + " " + signature.MethodName + "(" + strings.Join(params, ",") + "){return " + javaValue + ";}}"
	case "typescript":
		return "class Solution {" + signature.MethodName + "(...args:any[]):any{return " + jsValue + ";}}"
	}
	return "let " + signature.MethodName + " " + strings.Join(names, " ") + " = " + mlValue
}
