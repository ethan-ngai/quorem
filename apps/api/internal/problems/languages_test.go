package problems

import "testing"

func TestLanguageArtifactsCoverCorpus(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		if len(f.Implementations) != 4 {
			t.Fatal(f.Problem.Slug)
		}
		for _, impl := range f.Implementations {
			if impl.ReferenceSource == "" {
				t.Fatal(f.Problem.Slug, impl.Language)
			}
		}
	}
}

func TestLanguageTypes(t *testing.T) {
	for _, language := range []string{"java", "typescript", "ocaml"} {
		_, err := Starter(Signature{ClassName: "Solution", MethodName: "solve", Parameters: []Parameter{{Name: "value", Type: "list<optional<list<int>>>"}}, ReturnType: "optional<TreeNode>"}, language)
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := languageType("invalid", "java"); err == nil {
		t.Fatal("unsupported types accepted")
	}
}
