package problems

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInputPresetCompatibility(t *testing.T) {
	tests := []struct {
		preset, typ string
		valid       bool
	}{
		{"default", "optional<list<int>>", true}, {"number", "int", true}, {"number", "float", true},
		{"text", "str", true}, {"boolean", "bool", true}, {"sequence", "list<bool>", true},
		{"matrix", "list<list<int>>", true}, {"tree", "optional<TreeNode>", true},
		{"linkedList", "ListNode", true}, {"structured", "list<optional<list<str>>>", true},
		{"boolean", "list<bool>", false}, {"sequence", "bool", false}, {"matrix", "list<int>", false},
		{"tree", "ListNode", false}, {"number", "str", false}, {"oneOff", "int", false},
		{"structured", "object", false}, {"", "int", false},
	}
	for _, test := range tests {
		t.Run(test.preset+"/"+test.typ, func(t *testing.T) {
			sig := Signature{Parameters: []Parameter{{Name: "x", Type: test.typ, Input: &InputConfig{Preset: test.preset}}}, ReturnType: "int"}
			if err := ValidateConstraints(sig, nil); (err == nil) != test.valid {
				t.Fatalf("validation = %v, valid = %v", err, test.valid)
			}
		})
	}
}

func TestInputConfigBounds(t *testing.T) {
	for _, rows := range []int{0, 1, 8, 9} {
		err := ValidateInputConfig("str", &InputConfig{Preset: "text", Rows: &rows})
		if (err == nil) != (rows >= 1 && rows <= 8) {
			t.Fatalf("rows %d: %v", rows, err)
		}
	}
	for _, length := range []int{0, 512, 513} {
		placeholder := strings.Repeat("界", length)
		err := ValidateInputConfig("str", &InputConfig{Preset: "text", Placeholder: &placeholder})
		if (err == nil) != (length <= 512) {
			t.Fatalf("placeholder %d: %v", length, err)
		}
	}
	var input InputConfig
	for _, raw := range []string{`{"preset":"text","extra":true}`, `{"preset":"text","rows":1.5}`, `{"preset":"text","rows":null}`, `{"preset":"text","placeholder":null}`, `{"preset":null}`, `null`} {
		if json.Unmarshal([]byte(raw), &input) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestInputPresetCannotBypassWireCodec(t *testing.T) {
	sig := Signature{Parameters: []Parameter{{Name: "x", Type: "bool", Input: &InputConfig{Preset: "structured"}}}, ReturnType: "bool"}
	for _, raw := range []string{`"True"`, `1`, `[true]`, `{"value":true}`} {
		if ValidateCase(sig, Case{Args: []json.RawMessage{json.RawMessage(raw)}}, false) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if err := ValidateCase(sig, Case{Args: []json.RawMessage{json.RawMessage(`true`)}}, false); err != nil {
		t.Fatal(err)
	}
}
