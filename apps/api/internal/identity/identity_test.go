package identity

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestJWTVerification(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	fetches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches++
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kid": "key", "kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	}))
	defer server.Close()
	v := &JWTVerifier{Issuer: "issuer", Audience: "quorem-api", JWKSURL: server.URL, Resolve: func(_ context.Context, c Claims) (Principal, error) {
		return Principal{UserID: c.Subject, SessionID: c.SessionID}, nil
	}}
	now := time.Now().Unix()
	valid := Claims{Issuer: "issuer", Audience: "quorem-api", Subject: "immutable", SessionID: "live-session", EmailVerified: true, Issued: now, Expiry: now + 300}
	sign := func(c Claims, key ed25519.PrivateKey) string {
		h := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","kid":"key"}`))
		b, _ := json.Marshal(c)
		body := h + "." + base64.RawURLEncoding.EncodeToString(b)
		return body + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(body)))
	}
	if p, e := v.Verify(context.Background(), sign(valid, priv)); e != nil || p.UserID != "immutable" {
		t.Fatal(p, e)
	}
	if _, e := v.Verify(context.Background(), sign(valid, priv)); e != nil || fetches != 1 {
		t.Fatal("cache", e, fetches)
	}
	cases := []struct {
		name   string
		mutate func(*Claims)
	}{{"issuer", func(c *Claims) { c.Issuer = "other" }}, {"audience", func(c *Claims) { c.Audience = "other" }}, {"expired", func(c *Claims) { c.Expiry = now - 1 }}, {"unverified", func(c *Claims) { c.EmailVerified = false }}, {"missing session", func(c *Claims) { c.SessionID = "" }}, {"long lifetime", func(c *Claims) { c.Expiry = now + 301 }}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := valid
			tc.mutate(&c)
			if _, e := v.Verify(context.Background(), sign(c, priv)); e == nil {
				t.Fatal("accepted invalid identity")
			}
		})
	}
	_, forged, _ := ed25519.GenerateKey(rand.Reader)
	if _, e := v.Verify(context.Background(), sign(valid, forged)); e == nil {
		t.Fatal("accepted forged signature")
	}
	v.Resolve = func(context.Context, Claims) (Principal, error) { return Principal{}, ErrUnauthorized }
	if _, e := v.Verify(context.Background(), sign(valid, priv)); e == nil {
		t.Fatal("accepted disabled session")
	}
}
