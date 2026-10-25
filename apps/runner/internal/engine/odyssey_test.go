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

func TestDockerOdysseyIgnoresVoidReturns(t *testing.T) {
	if os.Getenv("QUOREM_TEST_DOCKER") != "1" {
		t.Skip("QUOREM_TEST_DOCKER=1 enables sandbox tests")
	}
	var f worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"signature":{"className":"Solution","methodName":"get","parameters":[],"returnType":"int"},"odyssey":{"levels":[{"methods":[{"className":"Solution","methodName":"save","parameters":[],"returnType":"void"},{"className":"Solution","methodName":"get","parameters":[],"returnType":"int"}]}]}},"hiddenCases":[{"args":[],"calls":[{"methodName":"save","args":[]},{"methodName":"get","args":[],"expected":3}]}]}`), &f); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ language, source string }{
		{"python", "class Solution:\n    def save(self):\n        self.value=3\n        return 42\n    def get(self):\n        return self.value\n"},
		{"typescript", "class Solution { value=0; save():number {this.value=3;return 42;} get():number{return this.value;} }"},
	} {
		t.Run(test.language, func(t *testing.T) {
			result := executeLanguage(t, f, test.language, test.source, "submit", f.HiddenCases)
			if result.Verdict != execution.Accepted {
				t.Fatalf("%+v", result)
			}
			wrong := executeLanguage(t, f, test.language, strings.Replace(test.source, "value=3", "value=0", 1), "submit", f.HiddenCases)
			if wrong.Verdict != execution.WrongAnswer {
				t.Fatalf("state change was not checked: %+v", wrong)
			}
		})
	}
}
