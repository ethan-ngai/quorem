package problems

import (
	"encoding/json"
	"testing"
)

func TestTypedCodec(t *testing.T) {
	tests := []struct {
		typ, input, want string
		valid            bool
	}{{"int", "2147483647", "2147483647", true}, {"int", "2147483648", "", false}, {"int", "true", "", false}, {"int", "1.0", "", false}, {"ListNode", "[]", "null", true}, {"ListNode", "[1,null]", "", false}, {"TreeNode", "[1,null,2,null,null]", "[1,null,2]", true}, {"TreeNode", "[1,null,null,2]", "", false}, {"TreeNode", "[null,1]", "", false}, {"list<int>", "[1,-2]", "[1,-2]", true}, {"optional<int>", "null", "null", true}}
	for _, test := range tests {
		t.Run(test.typ+test.input, func(t *testing.T) {
			got, err := Normalize(test.typ, json.RawMessage(test.input))
			if (err == nil) != test.valid {
				t.Fatalf("error %v", err)
			}
			if test.valid && string(got) != test.want {
				t.Fatalf("got %s", got)
			}
		})
	}
}
func TestFixtures(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, f := range fixtures {
		counts[f.Problem.Difficulty]++
		if len(f.HiddenCases) != 20 || f.ReferenceSource == "" || f.Attribution == "" {
			t.Fatal("incomplete fixture")
		}
	}
	for _, difficulty := range []string{"easy", "medium", "hard"} {
		if counts[difficulty] != 2 {
			t.Fatal(counts)
		}
	}
}
