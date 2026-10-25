package interviews

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// CodeMirror positions count UTF-16 units, including surrogate pairs in emoji.
func ApplyChanges(source string, changes json.RawMessage) (string, error) {
	var parts []json.RawMessage
	if len(changes) > MaxSourceBytes*2 || json.Unmarshal(changes, &parts) != nil || parts == nil || len(parts) > 4096 {
		return "", fmt.Errorf("invalid change set")
	}
	old := utf16.Encode([]rune(source))
	next := make([]uint16, 0, len(old))
	position := 0
	for _, part := range parts {
		var keep int
		if len(part) > 0 && part[0] != 'n' && json.Unmarshal(part, &keep) == nil {
			if keep < 0 || keep > len(old)-position {
				return "", fmt.Errorf("change length mismatch")
			}
			next = append(next, old[position:position+keep]...)
			position += keep
			continue
		}
		var replacement []json.RawMessage
		if json.Unmarshal(part, &replacement) != nil || len(replacement) == 0 || len(replacement[0]) == 0 || replacement[0][0] == 'n' || json.Unmarshal(replacement[0], &keep) != nil || keep < 0 || keep > len(old)-position {
			return "", fmt.Errorf("invalid replacement")
		}
		lines := make([]string, 0, len(replacement)-1)
		for _, raw := range replacement[1:] {
			var line string
			if len(raw) == 0 || raw[0] != '"' || !validJSONStringUTF16(raw) || json.Unmarshal(raw, &line) != nil || strings.Contains(line, "\n") || !utf8.ValidString(line) {
				return "", fmt.Errorf("invalid inserted text")
			}
			lines = append(lines, line)
		}
		next = append(next, utf16.Encode([]rune(strings.Join(lines, "\n")))...)
		position += keep
		if len(next) > MaxSourceBytes {
			return "", fmt.Errorf("document too large")
		}
	}
	if position != len(old) {
		return "", fmt.Errorf("change length mismatch")
	}
	for i := 0; i < len(next); i++ {
		if next[i] >= 0xD800 && next[i] <= 0xDBFF {
			if i+1 >= len(next) || next[i+1] < 0xDC00 || next[i+1] > 0xDFFF {
				return "", fmt.Errorf("split surrogate pair")
			}
			i++
		} else if next[i] >= 0xDC00 && next[i] <= 0xDFFF {
			return "", fmt.Errorf("split surrogate pair")
		}
	}
	result := string(utf16.Decode(next))
	if len(result) > MaxSourceBytes {
		return "", fmt.Errorf("document too large")
	}
	return result, nil
}

// encoding/json repairs lone surrogate escapes; reject them before peers can diverge.
func validJSONStringUTF16(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw)-1 {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		code, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if code >= 0xD800 && code <= 0xDBFF {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if err != nil || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			i += 6
		} else if code >= 0xDC00 && code <= 0xDFFF {
			return false
		}
	}
	return true
}
