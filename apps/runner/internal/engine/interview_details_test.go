package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
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
		return worker.Spec{Source: source, Kind: "submit", Fixture: fixture, Cases: fixture.HiddenCases[:1], PrivateDetails: private}, nil
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
