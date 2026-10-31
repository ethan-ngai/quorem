package main

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestGolden(t *testing.T) {
	pub, priv := vectors()
	for path, values := range map[string][]vector{"../../../../fixtures/migration/public/go-oracle.json": pub, "../../../../fixtures/migration/private/go-oracle.json": priv, "../../../../fixtures/migration/private/question-edge-oracle.json": questionVectors()} {
		got, err := encode(values)
		if err != nil {
			t.Fatal(err)
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("%s differs; run go run ./apps/api/cmd/migration-vectors from repository root", path)
		}
	}
}
func TestBoundaries(t *testing.T) {
	for _, tc := range []struct {
		source, changes, want string
		valid                 bool
	}{
		{"a😀b", `[1,[2,"x"],1]`, "axb", true}, {"a😀b", `[2,[1,"x"],1]`, "", false},
		{"", `[[0,"\ud800"]]`, "", false}, {"", `[[0,"\u0000"]]`, "", false}, {"a\x00b", `[3]`, "", false},
	} {
		got, err := interviews.ApplyChanges(tc.source, json.RawMessage(tc.changes))
		if (err == nil) != tc.valid || got != tc.want {
			t.Fatalf("%q %s: %q %v", tc.source, tc.changes, got, err)
		}
	}
	if execution.ValidSource("a\x00b") {
		t.Fatal("NUL source accepted")
	}
	if got, err := problems.Normalize("str", json.RawMessage(`"a\u0000b"`)); err != nil || string(got) != `"a\u0000b"` {
		t.Fatalf("case NUL: %s %v", got, err)
	}
}
func TestSQLAndVoid(t *testing.T) {
	p := problems.Problem{QuestionDefinition: problems.QuestionDefinition{SQL: &problems.SQLConfig{OutputOrder: "unordered", Output: []problems.SQLColumn{{Name: "n", Type: "numeric"}}}}}
	codec := problems.NewCaseCodec(p)
	c := problems.Case{Expected: json.RawMessage(`{"rows":[[{"$numeric":"1.00"}],[{"$numeric":"2"}],[{"$numeric":"1"}]]}`)}
	status, _, _, mismatch, err := codec.Compare(c, "executed", json.RawMessage(`{"rows":[[{"$numeric":"2.0"}],[{"$numeric":"1"}],[{"$numeric":"1"}]]}`), []string{"numeric"})
	if err != nil || status != "accepted" || mismatch {
		t.Fatal(status, mismatch, err)
	}
	status, _, _, mismatch, err = codec.Compare(c, "executed", json.RawMessage(`{"rows":[[{"$numeric":"2"}],[{"$numeric":"1"}]]}`), []string{"text"})
	if err != nil || status != "wrong_answer" || !mismatch {
		t.Fatal(status, mismatch, err)
	}
	void := problems.Problem{QuestionDefinition: problems.QuestionDefinition{Odyssey: &problems.Odyssey{Levels: []problems.OdysseyLevel{{Methods: []problems.Signature{{MethodName: "clear", ReturnType: "void"}}}}}}}
	call := problems.Case{Calls: []problems.MethodCall{{MethodName: "clear"}}}
	vc := problems.NewCaseCodec(void)
	actual, err := vc.Normalize(call, json.RawMessage(`[42]`))
	if err != nil || string(actual) != "[null]" || string(vc.Expected(call)) != "[null]" {
		t.Fatal(string(actual), string(vc.Expected(call)), err)
	}

}
