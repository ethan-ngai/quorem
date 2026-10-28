package interviews

import (
	"encoding/json"
	"testing"
)

func TestApplyChanges(t *testing.T) {
	tests := []struct{ source, changes, want string }{
		{"abc", `[1,[1,"XYZ"],1]`, "aXYZc"},
		{"hello", `[[0,"new",""],5]`, "new\nhello"},
		{"a😀b", `[3,[0,"!"],1]`, "a😀!b"},
		{"a😀b", `[1,[2,"🦊"],1]`, "a🦊b"},
		{"abc", `[[3]]`, ""},
		{"", `[]`, ""},
	}
	for _, tt := range tests {
		got, err := ApplyChanges(tt.source, json.RawMessage(tt.changes))
		if err != nil || got != tt.want {
			t.Errorf("%s: got %q, %v", tt.changes, got, err)
		}
	}
}
func TestRejectMalformedChanges(t *testing.T) {
	for _, changes := range []string{`null`, `[null,3]`, `[[null,"x"],3]`, `[[0,null],3]`, `[4]`, `[2]`, `[1.5]`, `[-1]`, `[[0,2],3]`, `[[0,"a\nb"],3]`, `[{}]`} {
		if _, err := ApplyChanges("abc", json.RawMessage(changes)); err == nil {
			t.Errorf("accepted %s", changes)
		}
	}
	for _, raw := range []string{`null`, `[[0,"\ud800"]]`, `[[0,"\udfff"]]`} {
		if _, err := ApplyChanges("", json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted malformed UTF16 %s", raw)
		}
	}
	if _, err := ApplyChanges("😀", json.RawMessage(`[1,[1]]`)); err == nil {
		t.Fatal("accepted split surrogate")
	}
}

func TestSourceNULRejectedButEscapedLiteralAllowed(t *testing.T) {
	if _, err := ApplyChanges("", json.RawMessage(`[[0,"a\u0000b"]]`)); err == nil {
		t.Fatal("accepted NUL source")
	}
	got, err := ApplyChanges("", json.RawMessage(`[[0,"print('\\\\0')"]]`))
	if err != nil || got != `print('\\0')` {
		t.Fatal(got, err)
	}
}
