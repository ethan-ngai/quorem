package execution

import "testing"

func TestRuntimeRevisionPairs(t *testing.T) {
	for _, language := range []string{"python", "java", "typescript", "ocaml"} {
		runtime, ok := LanguageRuntime(language)
		if !ok {
			t.Fatal(language)
		}
		resolved, ok := RuntimeForRevision(runtime.Revision, runtime.Harness)
		if !ok || resolved.Language != language {
			t.Fatal(resolved)
		}
		if _, ok = RuntimeForRevision(runtime.Revision, "unknown"); ok {
			t.Fatal("mismatched harness accepted")
		}
	}
	if _, ok := LanguageRuntime("rust"); ok {
		t.Fatal("unsupported language exposed")
	}
}
