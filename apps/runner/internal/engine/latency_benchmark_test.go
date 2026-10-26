package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// Real isolated execution, including Docker startup, compilation, comparison and teardown.
func BenchmarkDockerExecuteLatency(b *testing.B) {
	if os.Getenv("QUOREM_TEST_DOCKER") != "1" {
		b.Skip("QUOREM_TEST_DOCKER=1 enables actual sandbox latency measurements")
	}
	for _, language := range []string{"python", "java", "typescript", "ocaml"} {
		for _, scenario := range []struct {
			name           string
			cases, samples int
		}{
			{"1case", 1, 0}, {"4cases", 4, 0}, {"4cases-2samples", 4, 2},
		} {
			b.Run(language+"/"+scenario.name, func(b *testing.B) {
				runtime, ok := execution.LanguageRuntime(language)
				if !ok {
					b.Fatal("unsupported benchmark language")
				}
				fixture := worker.Fixture{}
				fixture.Problem.Signature.ClassName = "Solution"
				fixture.Problem.Signature.MethodName = "solve"
				fixture.Problem.Signature.ReturnType = "int"
				fixture.Problem.Signature.Parameters = []worker.Parameter{{Name: "value", Type: "int"}}
				source := map[string]string{
					"python":     "class Solution:\n    def solve(self, value):\n        return value + 1\n",
					"java":       "class Solution { public int solve(int value) { return value + 1; } }",
					"typescript": "class Solution { solve(value: number): number { return value + 1; } }",
					"ocaml":      "let solve (value:int) = value + 1",
				}[language]
				cases := func(count int) []worker.Case {
					out := make([]worker.Case, count)
					for i := range out {
						out[i] = worker.Case{Args: []json.RawMessage{json.RawMessage(strconv.Itoa(i))}, Expected: json.RawMessage(strconv.Itoa(i + 1))}
					}
					return out
				}
				spec := worker.Spec{Source: source, Kind: "submit", Fixture: fixture, Cases: cases(scenario.cases), SubmitSamples: cases(scenario.samples)}
				docker := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
				elapsed := make([]float64, 0, b.N)
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					job := execution.Job{Language: language, SubmissionID: "latency-fixture", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()}
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
					started := time.Now()
					result, err := docker.Execute(ctx, job)
					elapsed = append(elapsed, float64(time.Since(started))/float64(time.Millisecond))
					cancel()
					if err != nil {
						b.Fatal(err)
					}
					if result.Verdict != execution.Accepted || result.Score == nil || result.Score.Passed != scenario.cases || len(result.SubmitSampleResults) != scenario.samples {
						b.Fatalf("benchmark fixture failed: verdict=%s", result.Verdict)
					}
				}
				b.StopTimer()
				slices.Sort(elapsed)
				median := elapsed[len(elapsed)/2]
				if len(elapsed)%2 == 0 {
					median = (elapsed[len(elapsed)/2-1] + median) / 2
				}
				b.ReportMetric(median, "median-ms/op")
				b.ReportMetric(elapsed[0], "min-ms/op")
				b.ReportMetric(elapsed[len(elapsed)-1], "max-ms/op")
			})
		}
	}
}
