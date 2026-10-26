package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func executeCompiledCases(t *testing.T, fixture worker.Fixture, language, source string, cases []worker.Case) {
	t.Helper()
	runtime, _ := execution.LanguageRuntime(language)
	engine := &Docker{}
	if suffix := os.Getenv("QUOREM_TEST_COMPILED_IMAGE_SUFFIX"); suffix != "" {
		engine.Images = map[string]string{language: "quorem-" + language + ":" + suffix}
	}
	spec := worker.Spec{Source: source, Kind: "run", Fixture: fixture, Cases: cases}
	job := execution.Job{SubmissionID: "compiled", AttemptID: rand.Text(), Language: language, RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()}
	ctx, done := context.WithTimeout(context.Background(), time.Minute)
	defer done()
	artifact, compiled, err := engine.compileSubmission(ctx, job, spec)
	if err != nil || compiled.Status != "executed" {
		t.Fatalf("compile: %+v %v", compiled, err)
	}
	for i, c := range cases {
		result, err := engine.runRequest(ctx, job, i, compiledCaseRequest(spec, c, artifact), job.Limits.OutputBytes)
		if err != nil || result.Status != "executed" {
			t.Fatalf("case%d: %+v %v", i, result, err)
		}
		actual, err := worker.NormalizeCaseOutput(fixture, c, result.Actual)
		if err != nil {
			t.Fatal(err)
		}
		expected, err := worker.NormalizeCaseOutput(fixture, c, worker.CaseExpected(fixture, c))
		if err != nil {
			t.Fatal(err)
		}
		if string(actual) != string(expected) {
			t.Fatalf("case%d: actual=%s expected=%s", i, actual, expected)
		}
	}
}

func TestDockerCompiledCasesRetainFreshProcessAndFilesystem(t *testing.T) {
	fixture := dockerTests(t)[0]
	fixture.Problem.Signature.ClassName = "Solution"
	fixture.Problem.Signature.MethodName = "solve"
	fixture.Problem.Signature.Parameters = []worker.Parameter{{Name: "n", Type: "int"}}
	fixture.Problem.Signature.ReturnType = "int"
	for _, test := range []struct{ language, source string }{
		{"java", `class Solution { static int count=0;public int solve(int n)throws Exception {java.nio.file.Path p=java.nio.file.Path.of("/tmp/case-marker");if(java.nio.file.Files.exists(p))return -1;java.nio.file.Files.writeString(p,"previous");return n+(++count);}}`},
		{"typescript", `class Solution {static count=0;solve(n:number):number {const fs=process.getBuiltinModule('fs');if(fs.existsSync('/tmp/case-marker'))return -1;fs.writeFileSync('/tmp/case-marker','previous');return n+(++Solution.count);}}`},
		{"ocaml", `let count=ref 0
let solve n = if Sys.file_exists "/tmp/case-marker" then -1 else (let out=open_out "/tmp/case-marker" in output_string out "previous";close_out out;incr count;n + !count)`},
	} {
		t.Run(test.language, func(t *testing.T) {
			executeCompiledCases(t, fixture, test.language, test.source, []worker.Case{{Args: []json.RawMessage{json.RawMessage(`1234567`)}, Expected: json.RawMessage(`1234568`)}, {Args: []json.RawMessage{json.RawMessage(`2`)}, Expected: json.RawMessage(`3`)}})
		})
	}
}

func TestDockerCompiledDynamicNestedUnicodeInput(t *testing.T) {
	fixture := dockerTests(t)[0]
	fixture.Problem.Signature.ClassName = "Solution"
	fixture.Problem.Signature.MethodName = "solve"
	fixture.Problem.Signature.Parameters = []worker.Parameter{{Name: "value", Type: "list<list<optional<str>>>"}}
	fixture.Problem.Signature.ReturnType = "list<list<optional<str>>>"
	for _, test := range []struct{ language, source string }{
		{"java", `class Solution {public java.util.List<java.util.List<String>> solve(java.util.List<java.util.List<String>> value){return value;}}`},
		{"typescript", `class Solution {solve(value:(string|null)[][]):(string|null)[][]{return value;}}`},
		{"ocaml", `let solve (value:string option list list) = value`},
	} {
		t.Run(test.language, func(t *testing.T) {
			a := json.RawMessage(`[["a😀",null,"\"\\\n\u0001"],[]]`)
			b := json.RawMessage(`[["second case","é"],[null]]`)
			executeCompiledCases(t, fixture, test.language, test.source, []worker.Case{{Args: []json.RawMessage{a}, Expected: a}, {Args: []json.RawMessage{b}, Expected: b}})
		})
	}
}
