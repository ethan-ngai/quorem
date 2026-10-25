package identity

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Principal struct {
	Guest         bool
	MatchID       string
	StrongUntil   int64
	UserID        string
	SessionID     string
	DisplayName   string
	EmailVerified bool
	Admin         bool
}
type contextKey struct{}

func With(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, p)
}
func Subject(ctx context.Context) Principal { p, _ := ctx.Value(contextKey{}).(Principal); return p }

type Verifier interface {
	Verify(context.Context, string) (Principal, error)
}
type Claims struct {
	Image         string `json:"image"`
	Issuer        string `json:"iss"`
	Subject       string `json:"sub"`
	Audience      string `json:"aud"`
	Expiry        int64  `json:"exp"`
	Issued        int64  `json:"iat"`
	SessionID     string `json:"sessionId"`
	EmailVerified bool   `json:"emailVerified"`
	Name          string `json:"name"`
}
type Resolver func(context.Context, Claims) (Principal, error)
type JWTVerifier struct {
	Issuer, Audience, JWKSURL string
	Resolve                   Resolver
	Client                    *http.Client
	mu                        sync.Mutex
	keys                      map[string]ed25519.PublicKey
	fetched, attempted        time.Time
}

var ErrUnauthorized = errors.New("identity unavailable")

func (v *JWTVerifier) Verify(ctx context.Context, token string) (Principal, error) {
	if len(token) > 16384 {
		return Principal{}, ErrUnauthorized
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Principal{}, ErrUnauthorized
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	var c Claims
	h, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil || json.Unmarshal(h, &header) != nil || header.Alg != "EdDSA" || header.Kid == "" {
		return Principal{}, ErrUnauthorized
	}
	body, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || json.Unmarshal(body, &c) != nil {
		return Principal{}, ErrUnauthorized
	}
	now := time.Now().Unix()
	if c.Issuer != v.Issuer || c.Audience != v.Audience || c.Subject == "" || c.SessionID == "" || !c.EmailVerified || c.Expiry <= now || c.Issued > now+30 || c.Issued <= 0 || c.Expiry-c.Issued > 300 {
		return Principal{}, ErrUnauthorized
	}
	key, e := v.key(ctx, header.Kid)
	if e != nil {
		return Principal{}, e
	}
	sig, e := base64.RawURLEncoding.DecodeString(parts[2])
	if e != nil || !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), sig) {
		return Principal{}, ErrUnauthorized
	}
	if v.Resolve == nil {
		return Principal{}, ErrUnauthorized
	}
	return v.Resolve(ctx, c)
}
func (v *JWTVerifier) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if key := v.keys[kid]; key != nil && time.Since(v.fetched) < 5*time.Minute {
		return key, nil
	}
	// Bound refreshes, including attacker-controlled unknown key IDs.
	if time.Since(v.attempted) < time.Second {
		return nil, ErrUnauthorized
	}
	v.attempted = time.Now()
	req, e := http.NewRequestWithContext(ctx, "GET", v.JWKSURL, nil)
	if e != nil {
		return nil, e
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	resp, e := client.Do(req)
	if e != nil {
		return nil, ErrUnauthorized
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, ErrUnauthorized
	}
	var set struct {
		Keys []struct{ Kid, Kty, Crv, X string }
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&set) != nil || len(set.Keys) > 20 {
		return nil, ErrUnauthorized
	}
	keys := map[string]ed25519.PublicKey{}
	for _, j := range set.Keys {
		b, e := base64.RawURLEncoding.DecodeString(j.X)
		if e == nil && j.Kty == "OKP" && j.Crv == "Ed25519" && len(b) == ed25519.PublicKeySize {
			keys[j.Kid] = b
		}
	}
	v.keys = keys
	v.fetched = time.Now()
	if key := keys[kid]; key != nil {
		return key, nil
	}
	return nil, ErrUnauthorized
}
