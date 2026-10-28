package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestDockerInterviewPrivateDetailsRemainSeparate(t *testing.T) {
	fixtures := dockerTests(t)
	var fixture worker.Fixture
	for _, f := range fixtures {
		if f.Problem.Slug == "run-widths" {
			fixture = f
		}
	}
	source := `import sys
class Solution:
 def runWidths(self,values):
  print('private stdout',values)
  print('private stderr',file=sys.stderr)
  return [999]
`
	private := true
	d := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: source, Kind: "submit", Problem: fixture.Problem, Cases: fixture.HiddenCases[:1], PrivateDetails: private}, nil
	}}
	job := execution.Job{SubmissionID: "interview-details", AttemptID: rand.Text(), RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := d.Execute(ctx, job)
	if err != nil || len(result.PrivateCaseResults) != 1 || len(result.PublicCaseResults) != 0 {
		t.Fatal("interview private capture", result, err)
	}
	r := result.PrivateCaseResults[0]
	if r.Status != "wrong_answer" || string(r.Actual) != "[999]" || len(r.Expected) == 0 || !strings.Contains(r.Stdout, "private stdout") || !strings.Contains(r.Stderr, "private stderr") {
		t.Fatal("missing private fields", r)
	}
	private = false
	job.AttemptID = rand.Text()
	regular, err := d.Execute(ctx, job)
	if err != nil || len(regular.PrivateCaseResults) != 0 || len(regular.PublicCaseResults) != 0 {
		t.Fatal("regular hidden result captured", regular, err)
	}
	data, _ := json.Marshal(regular)
	if strings.Contains(string(data), "private stdout") || strings.Contains(string(data), "private stderr") {
		t.Fatal("regular hidden output leaked", string(data))
	}
}

func TestDockerSubmitSamplesRemainSeparateFromHiddenScoring(t *testing.T) {
	fixtures := dockerTests(t)
	var fixture worker.Fixture
	for _, f := range fixtures {
		if f.Problem.Slug == "run-widths" {
			fixture = f
		}
	}
	d := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: fixture.ReferenceSource, Kind: "submit", Problem: fixture.Problem, Cases: fixture.HiddenCases[:1], SubmitSamples: fixture.Problem.SampleCases()}, nil
	}}
	job := execution.Job{SubmissionID: "submit-samples", AttemptID: rand.Text(), RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := d.Execute(ctx, job)
	if err != nil || result.Score == nil || result.Score.Total != 1 || result.Score.Passed != 1 || len(result.HiddenCases) != 1 || len(result.PrivateCaseResults) != 0 || len(result.PublicCaseResults) != 0 || len(result.SubmitSampleResults) != len(fixture.Problem.Examples) {
		t.Fatal("submit sample separation", result, err)
	}
	for i, r := range result.SubmitSampleResults {
		if r.Index != i || r.Status != "accepted" || len(r.Actual) == 0 {
			t.Fatal("sample output", r)
		}
	}
}

func TestDockerInterviewPublicFallback(t *testing.T) {
	fixtures := dockerTests(t)
	fixture := fixtures[0]
	samples := fixture.Problem.SampleCases()
	for _, tc := range []struct {
		name, source string
		verdict      execution.Verdict
	}{
		{"accepted", fixture.ReferenceSource, execution.Accepted},
		{"wrong answer", "class Solution:\n def levelSpreads(self, root): return [123]\n", execution.WrongAnswer},
		{"syntax error", "class Solution:\n def levelSpreads(self, root)\n  return []\n", execution.SyntaxError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
				return worker.Spec{Source: tc.source, Kind: "submit", Problem: fixture.Problem, Cases: samples, SubmitSamples: samples, PrivateDetails: true, SubmitCasesAreSamples: true}, nil
			}}
			job := execution.Job{SubmissionID: "fallback", AttemptID: rand.Text(), RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			result, err := d.Execute(ctx, job)
			if err != nil || result.Verdict != tc.verdict || result.Score == nil || result.Score.Total != len(samples) || len(result.HiddenCases) != len(samples) || !reflect.DeepEqual(result.PrivateCaseResults, result.SubmitSampleResults) {
				t.Fatal(result, err)
			}
			for i, got := range result.SubmitSampleResults {
				if got.Index != i || got.Status == "" {
					t.Fatal(got)
				}
			}
		})
	}
}
