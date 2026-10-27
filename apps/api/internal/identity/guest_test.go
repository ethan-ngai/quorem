package identity

import (
	"strings"
	"testing"
)

func TestGuestTokenAndName(t *testing.T) {
	first, err := NewGuestToken()
	if err != nil || !ValidGuestToken(first) {
		t.Fatalf("generated token invalid: %v", err)
	}
	second, err := NewGuestToken()
	if err != nil || second == first || !ValidGuestToken(second) {
		t.Fatalf("second token invalid: %v", err)
	}
	for _, invalid := range []string{"", strings.Repeat("!", 43), first[:42]} {
		if ValidGuestToken(invalid) {
			t.Fatal("accepted invalid credential")
		}
	}
	for _, tc := range []struct {
		input, want string
		valid       bool
	}{
		{"  Alice  ", "Alice", true},
		{strings.Repeat("界", 40), strings.Repeat("界", 40), true},
		{" ", "", false},
		{"Alice\nBob", "Alice\nBob", false},
		{strings.Repeat("x", 41), strings.Repeat("x", 41), false},
	} {
		if name, valid := GuestName(tc.input); name != tc.want || valid != tc.valid {
			t.Fatalf("name %q: %q, %v", tc.input, name, valid)
		}
	}
}
