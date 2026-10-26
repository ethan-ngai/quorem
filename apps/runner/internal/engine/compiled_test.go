package engine

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/worker"
)

func TestCompilationRequestDoesNotCarryCaseData(t *testing.T) {
	spec := worker.Spec{Source: "submitted source", Kind: "submit", Cases: []worker.Case{{Args: []json.RawMessage{json.RawMessage(`"private input sentinel"`)}, Expected: json.RawMessage(`"private expected sentinel"`)}}, SubmitSamples: []worker.Case{{Args: []json.RawMessage{json.RawMessage(`"sample sentinel"`)}}}}
	request := compilationRequest(spec)
	for _, private := range []string{"private input sentinel", "private expected sentinel", "sample sentinel"} {
		if bytes.Contains(request, []byte(private)) {
			t.Fatal("case data entered compiler request")
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(request, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 4 {
		t.Fatalf("unexpected compile fields: %s", request)
	}
	for _, key := range []string{"operation", "source", "signature", "methods"} {
		if _, ok := fields[key]; !ok {
			t.Fatalf("missing %s", key)
		}
	}
	first := compiledFirstCaseRequest(spec, worker.Case{Args: []json.RawMessage{json.RawMessage(`"current input"`)}, Expected: json.RawMessage(`"current expected"`)})
	for _, private := range []string{"private input sentinel", "private expected sentinel", "sample sentinel", "current expected"} {
		if bytes.Contains(first, []byte(private)) {
			t.Fatalf("unexpected %s in first execute request", private)
		}
	}
	if !bytes.Contains(first, []byte("current input")) {
		t.Fatal("current first input absent")
	}
	artifact := json.RawMessage(`{"version":1,"language":"typescript","files":{"main.js":"eA=="}}`)
	current := worker.Case{Args: []json.RawMessage{json.RawMessage(`"current input"`)}, Expected: json.RawMessage(`"current expected"`)}
	execution := compiledCaseRequest(spec, current, artifact)
	for _, private := range []string{"private input sentinel", "private expected sentinel", "sample sentinel", "current expected", "submitted source"} {
		if bytes.Contains(execution, []byte(private)) {
			t.Fatalf("unexpected %s in execute request", private)
		}
	}
	if !bytes.Contains(execution, []byte("current input")) {
		t.Fatal("current input absent")
	}
}

func TestCompiledArtifactValidationRejectsTraversalAndOversize(t *testing.T) {
	for _, test := range []struct {
		name, raw, language string
		valid               bool
	}{
		{"valid java", `{"version":1,"language":"java","files":{"Main.class":"eA==","Solution$Nested.class":"eA=="}}`, "java", true},
		{"valid typescript", `{"version":1,"language":"typescript","files":{"main.js":"eA=="}}`, "typescript", true},
		{"valid ocaml", `{"version":1,"language":"ocaml","files":{"main.byte":"eA=="}}`, "ocaml", true},
		{"traversal", `{"version":1,"language":"java","files":{"Main.class":"eA==","../secret.class":"eA=="}}`, "java", false},
		{"absolute path", `{"version":1,"language":"java","files":{"Main.class":"eA==","/tmp/Payload.class":"eA=="}}`, "java", false},
		{"language mismatch", `{"version":1,"language":"java","files":{"Main.class":"eA=="}}`, "typescript", false},
		{"missing entrypoint", `{"version":1,"language":"java","files":{"Solution.class":"eA=="}}`, "java", false},
		{"unexpected field", `{"version":1,"language":"typescript","files":{"main.js":"eA=="},"cases":[1]}`, "typescript", false},
		{"extra runtime file", `{"version":1,"language":"typescript","files":{"main.js":"eA==","extra.js":"eA=="}}`, "typescript", false},
		{"bad encoding", `{"version":1,"language":"typescript","files":{"main.js":"!!!"}}`, "typescript", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateCompiledArtifact(json.RawMessage(test.raw), test.language)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v err=%v", test.valid, err)
			}
		})
	}
	if validateCompiledArtifact(bytes.Repeat([]byte("x"), compiledArtifactLimit+1), "java") == nil {
		t.Fatal("unbounded artifact accepted")
	}
}
