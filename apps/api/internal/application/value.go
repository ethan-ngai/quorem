package application

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

// Error exposes only application-approved messages to transports.
type Error struct {
	Code    string
	Message string
	Status  int
}

func (e *Error) Error() string { return e.Message }

func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func Hash(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
