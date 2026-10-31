// migration-vectors exports observed Go behavior for cross-runtime comparison.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type vector struct {
	Name   string `json:"name"`
	Input  any    `json:"input"`
	Output any    `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

func result(name string, input, output any, err error) vector {
	v := vector{Name: name, Input: input, Output: output}
	if err != nil {
		v.Error = err.Error()
		v.Output = nil
	}
	return v
}
func raw(s string) json.RawMessage { return json.RawMessage(s) }
func vectors() (public, private []vector) {
	for _, t := range []struct{ typ, value string }{{"int", "2147483647"}, {"int", "2147483648"}, {"int", "1.0"}, {"long", "9007199254740993"}, {"float", "-0.0"}, {"float", "1e2"}, {"TreeNode", "[1,null,2,null,null]"}, {"ListNode", "[]"}, {"str", `"a\u0000b"`}} {
		out, err := problems.Normalize(t.typ, raw(t.value))
		public = append(public, result("normalize", map[string]string{"type": t.typ, "json": t.value}, string(out), err))
	}
	sig := problems.Signature{ClassName: "Solution", MethodName: "sum", Parameters: []problems.Parameter{{Name: "values", Type: "list<int>"}}, ReturnType: "int"}
	for _, lang := range []string{"python", "java", "typescript", "ocaml"} {
		out, err := problems.GenerateStarter([]problems.Signature{sig}, lang, false)
		public = append(public, result("starter", map[string]any{"signature": sig, "language": lang}, out, err))
	}
	for _, c := range []problems.Case{{Args: []json.RawMessage{raw("[1,2]")}, Expected: raw("3")}, {Args: []json.RawMessage{raw("[1,2.0]")}, Expected: raw("3")}, {Args: []json.RawMessage{}, Expected: raw("3")}} {
		err := problems.ValidateCase(sig, c, true)
		public = append(public, result("validateCase", map[string]any{"signature": sig, "case": c}, err == nil, err))
	}
	for _, content := range []problems.QuestionContent{
		{},
		{Problem: problems.QuestionDefinition{Companies: []string{"Acme", "acme"}}},
		{Implementations: []problems.AuthoringImplementation{{LanguageImplementation: problems.LanguageImplementation{StarterSource: "bad\x00source"}}}},
	} {
		err := problems.ValidateQuestionDraft(content)
		public = append(public, result("validateDraft", content, err == nil, err))
		err = problems.ValidateQuestionDefinition(content, false)
		public = append(public, result("validateDefinition", content, err == nil, err))
	}

	for _, t := range []struct{ source, changes string }{{"a😀b", `[1,[2,"x"],1]`}, {"a😀b", `[2,[1,"x"],1]`}, {"e\u0301", `[2,[0,""]]`}, {"", `[[0,"\ud83d\ude00"]]`}, {"", `[[0,"\ud800"]]`}, {"", `[[0,"\udc00"]]`}, {"", `[[0,"\u0000"]]`}, {"a\x00b", `[3]`}, {"abc", `[3]`}} {
		out, err := interviews.ApplyChanges(t.source, raw(t.changes))
		public = append(public, result("changes", map[string]string{"source": t.source, "changes": t.changes}, out, err))
	}
	for _, source := range []string{"", "a😀b", "a\x00b", "<&>\n"} {
		public = append(public, vector{Name: "source", Input: source, Output: map[string]any{"valid": execution.ValidSource(source), "utf8Bytes": len(source), "sha256": application.Hash([]byte(source))}})
	}
	for _, lang := range []string{"python", "postgresql", "java", "typescript", "ocaml", "unknown"} {
		runtime, ok := execution.LanguageRuntime(lang)
		private = append(private, vector{Name: "runtime", Input: lang, Output: map[string]any{"found": ok, "runtime": runtime}})
	}
	p := problems.Problem{QuestionDefinition: problems.QuestionDefinition{SQL: &problems.SQLConfig{Dialect: "postgresql", OutputOrder: "unordered", Output: []problems.SQLColumn{{Name: "n", Type: "numeric"}}}}}
	for _, value := range []string{`{"rows":[[{"$numeric":"12345678901234567890.1200"}],[{"$numeric":"-0.00"}]]}`, `{"rows":[[{"$numeric":"1e2"}]]}`, `{"rows":[["123"]]}`} {
		out, err := problems.NewCaseCodec(p).Normalize(problems.Case{}, raw(value))
		private = append(private, result("sqlNormalize", map[string]any{"problem": p.QuestionDefinition, "json": value}, string(out), err))
	}
	for _, item := range []struct{ kind, value string }{
		{"real", `{"rows":[[0.1],[10000000000]]}`},
		{"double precision", `{"rows":[[-0.0],[1e2]]}`},
		{"timestamp", `{"rows":[["2024-01-01 12:00:00.1234565"]]}`},
		{"timestamptz", `{"rows":[["2024-01-01T12:00:00+02:00"]]}`},
	} {
		q := problems.Problem{QuestionDefinition: problems.QuestionDefinition{SQL: &problems.SQLConfig{OutputOrder: "ordered", Output: []problems.SQLColumn{{Name: "value", Type: item.kind}}}}}
		value, err := problems.NewCaseCodec(q).Normalize(problems.Case{}, raw(item.value))
		private = append(private, result("sqlTyped", map[string]any{"problem": q.QuestionDefinition, "json": item.value}, string(value), err))
	}
	for _, value := range []any{map[string]any{"z": "<&>", "a": []any{}}, map[string]any{"a": nil}, map[string]any{}} {
		b, _ := json.Marshal(value)
		public = append(public, vector{Name: "goJSONHash", Input: value, Output: map[string]string{"json": string(b), "sha256": application.Hash(b)}})
	}

	void := problems.Problem{QuestionDefinition: problems.QuestionDefinition{Odyssey: &problems.Odyssey{Levels: []problems.OdysseyLevel{{Methods: []problems.Signature{{ClassName: "Solution", MethodName: "clear", ReturnType: "void"}}}}}}}
	c := problems.Case{Args: []json.RawMessage{}, Calls: []problems.MethodCall{{MethodName: "clear", Args: []json.RawMessage{}}}}
	codec := problems.NewCaseCodec(void)
	out, err := codec.Normalize(c, raw("[42]"))
	private = append(private, result("voidSequence", map[string]any{"problem": void.QuestionDefinition, "case": c, "json": "[42]"}, map[string]string{"actual": string(out), "expected": string(codec.Expected(c))}, err))
	checkpoint := execution.CheckpointCase{Ordinal: 2, Frame: raw(`{"status":"executed","output":"private"}`), Artifact: raw(`{"kind":"compiled"}`), CompilationNanos: 123456789, Fatal: raw(`null`)}
	encoded, _ := json.Marshal(checkpoint)
	private = append(private, vector{Name: "checkpointCaseJSON", Input: checkpoint, Output: string(encoded)})
	return
}
func encode(v []vector) ([]byte, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	return append(b, '\n'), err
}
func main() {
	pub, priv := vectors()
	for path, v := range map[string][]vector{"fixtures/migration/public/go-oracle.json": pub, "fixtures/migration/private/go-oracle.json": priv} {
		b, err := encode(v)
		if err == nil {
			err = os.MkdirAll(filepath.Dir(path), 0755)
		}
		if err == nil {
			err = os.WriteFile(path, b, 0644)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
