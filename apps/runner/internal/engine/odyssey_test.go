package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"strings"
	"testing"
	"time"
)

func TestDockerOdysseyStatefulSequences(t *testing.T) {
	isolated := os.Getenv("QUOREM_TEST_ODYSSEY_DOCKER") == "1"
	if !isolated && os.Getenv("QUOREM_TEST_DOCKER") != "1" {
		t.Skip("QUOREM_TEST_DOCKER=1 enables sandbox tests")
	}
	var content struct {
		Problem struct {
			Odyssey json.RawMessage `json:"odyssey"`
		}
		Implementations    []struct{ Language, ReferenceSource string }
		OdysseyHiddenCases [][]worker.Case
	}
	data, err := os.ReadFile("../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	var fixture worker.Fixture
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	cases := append(append([]worker.Case{}, fixture.OdysseyHiddenCases[0]...), fixture.OdysseyHiddenCases[1]...)
	for _, impl := range content.Implementations {
		t.Run(impl.Language, func(t *testing.T) {
			runtime, _ := execution.LanguageRuntime(impl.Language)
			image := runtime.Image
			if isolated {
				image = "quorem-" + impl.Language + ":odyssey-test"
			}
			d := &Docker{Images: map[string]string{impl.Language: image}, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
				return worker.Spec{Source: impl.ReferenceSource, Kind: "submit", Fixture: fixture, Cases: cases}, nil
			}}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			result, err := d.Execute(ctx, execution.Job{SubmissionID: "odyssey", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
			if err != nil || result.Verdict != execution.Accepted || result.Score == nil || result.Score.Passed != 4 {
				t.Fatalf("%+v %v", result, err)
			}
			replacements := map[string][2]string{"python": {"self.balance += amount", "self.balance += 0"}, "java": {"balance+=amount", "balance+=0"}, "typescript": {"balance+=amount", "balance+=0"}, "ocaml": {"!balance + amount", "!balance + 0"}}
			change := replacements[impl.Language]
			impl.ReferenceSource = strings.Replace(impl.ReferenceSource, change[0], change[1], 1)
			failed, err := d.Execute(ctx, execution.Job{SubmissionID: "regression", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
			if err != nil || failed.Verdict != execution.WrongAnswer || failed.Score == nil || failed.Score.Passed == failed.Score.Total {
				t.Fatalf("old-method regression accepted: %+v %v", failed, err)
			}

		})
	}
}

func TestOdysseySandboxRequestOmitsExpectations(t *testing.T) {
	var c worker.Case
	if err := json.Unmarshal([]byte(`{"args":[],"calls":[{"methodName":"deposit","args":[1],"expected":"private expectation sentinel"}]}`), &c); err != nil {
		t.Fatal(err)
	}
	data := sandboxRequest(worker.Spec{Source: "candidate source"}, c)
	if strings.Contains(string(data), "expected") || strings.Contains(string(data), "private expectation sentinel") {
		t.Fatal("private expectation sent to contestant sandbox", string(data))
	}
}
