package postgres

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Durable local key keeps invitation capabilities out of database response caches.
func loadInviteKey() ([]byte, error) {
	if value := os.Getenv("QUOREM_INVITE_KEY"); value != "" {
		key, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil || len(key) != 32 {
			return nil, errors.New("QUOREM_INVITE_KEY must be a base64url 32-byte key")
		}
		return key, nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(cache, "quorem")
	path := filepath.Join(dir, "invite-key")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	key, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		f, err := os.CreateTemp(dir, "invite-key-")
		if err != nil {
			return nil, err
		}
		name := f.Name()
		defer os.Remove(name)
		if _, err = f.Write(key); err != nil {
			f.Close()
			return nil, err
		}
		if err = f.Close(); err != nil {
			return nil, err
		}
		// Linking the complete file atomically elects one key across concurrent processes.
		if err = os.Link(name, path); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		key, err = os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("invalid local invite key")
	}
	if err = os.Chmod(path, 0600); err != nil {
		return nil, err
	}
	return key, nil
}
func (s *Store) inviteCipher() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.inviteKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (s *Store) encryptInviteResponse(data []byte) ([]byte, error) {
	aead, err := s.inviteCipher()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	sealed := aead.Seal(nonce, nonce, data, []byte("quorem:create-match:v1"))
	return json.Marshal(map[string]string{"encrypted": base64.RawURLEncoding.EncodeToString(sealed)})
}
func (s *Store) decryptInviteResponse(data []byte) ([]byte, error) {
	var response struct {
		Encrypted string `json:"encrypted"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, err
	}
	sealed, err := base64.RawURLEncoding.DecodeString(response.Encrypted)
	if err != nil {
		return nil, err
	}
	aead, err := s.inviteCipher()
	if err != nil {
		return nil, err
	}
	if len(sealed) < aead.NonceSize() {
		return nil, errors.New("invalid invitation response")
	}
	return aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte("quorem:create-match:v1"))
}
