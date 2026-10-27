package identity

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"unicode/utf8"
)

func NewGuestToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func ValidGuestToken(token string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(raw) == 32
}

func GuestName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	length := utf8.RuneCountInString(name)
	return name, length >= 1 && length <= 40 && !strings.ContainsAny(name, "\r\n\t")
}
