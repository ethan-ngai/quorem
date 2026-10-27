package execution

import "testing"

func TestRuntimeRevisionPairs(t *testing.T) {
	for _, language := range []string{"python", "java", "typescript", "ocaml", "postgresql"} {
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
	current, _ := LanguageRuntime("postgresql")
	if current.Harness != "quorem-postgresql-v2" {
		t.Fatal("schema questions need the new harness")
	}
	if _, ok := RuntimeForRevision(current.Revision, "quorem-postgresql-v1"); !ok {
		t.Fatal("legacy SQL versions must remain runnable")
	}
	if _, ok := LanguageRuntime("rust"); ok {
		t.Fatal("unsupported language exposed")
	}
}
