package problems

import (
	"os/exec"
	"strings"
	"testing"
)

func TestGeneratedStarterDocumentsMethodsSafely(t *testing.T) {
	sig := Signature{ClassName: "Solution", MethodName: "solve", ReturnType: "int", Description: "Describe */ *) \"\"\" and \\ text", Parameters: []Parameter{{Name: "value", Type: "int", Description: "input value"}}, Returns: "the answer", Throws: []MethodException{{Type: "ValueError", Description: "invalid input"}}}
	for _, lang := range []string{"python", "java", "typescript", "ocaml"} {
		t.Run(lang, func(t *testing.T) {
			source, err := GenerateStarter([]Signature{sig}, lang, false)
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{"input value", "the answer", "invalid input"} {
				if !strings.Contains(source, want) {
					t.Fatalf("missing %q in %s", want, source)
				}
			}
			if lang == "python" {
				cmd := exec.Command("python3", "-c", "import ast,sys; ast.parse(sys.stdin.read())")
				cmd.Stdin = strings.NewReader(source)
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("invalid Python: %s %v", out, err)
				}
			}
			if lang == "java" || lang == "typescript" {
				if strings.Contains(source, "Describe */") {
					t.Fatal("unescaped terminator", source)
				}
			}
			if lang == "ocaml" && strings.Contains(source, "Describe */ *)") {
				t.Fatal("unescaped terminator", source)
			}
		})
	}
}
