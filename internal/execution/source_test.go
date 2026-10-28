package execution

import (
	"strings"
	"testing"
)

func TestValidSource(t *testing.T) {
	for _, tc := range []struct {
		source string
		valid  bool
	}{
		{"", true}, {`return "\\0"`, true}, {"return \"\x00\"", false}, {string([]byte{0xff}), false}, {strings.Repeat("x", MaxSourceBytes), true}, {strings.Repeat("x", MaxSourceBytes+1), false},
	} {
		if got := ValidSource(tc.source); got != tc.valid {
			t.Fatalf("source length %d: valid=%v", len(tc.source), got)
		}
	}
}
