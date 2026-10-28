package engine

import (
	"strings"
	"testing"
)

func TestDockerCapturesNULInContestantOutput(t *testing.T) {
	fixtures := dockerTests(t)
	f := fixtures[0]
	result := executeFixture(t, f, "print('\\x00')\n"+f.ReferenceSource, "run", f.Problem.SampleCases())
	if len(result.PublicCaseResults) == 0 || !strings.Contains(result.PublicCaseResults[0].Stdout, "\x00") {
		t.Fatalf("NUL missing from contestant output: %+v", result.PublicCaseResults)
	}
}
