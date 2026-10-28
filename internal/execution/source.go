package execution

import (
	"strings"
	"unicode/utf8"
)

const MaxSourceBytes = 65536

// Source is stored as PostgreSQL text; escaped language literals remain ordinary text.
func ValidSource(source string) bool {
	return len(source) <= MaxSourceBytes && utf8.ValidString(source) && !strings.ContainsRune(source, 0)
}
