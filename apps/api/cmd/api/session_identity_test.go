package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

func TestSessionResolverDistinguishesRevocationFromOutage(t *testing.T) {
	for _, status := range []int{204, 401, 403, 404, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer internal-fixture" || r.Header.Get("X-Auth-Subject") != "subject" || r.URL.Path != "/internal/session/session" {
					t.Error("incorrect session verification request")
				}
				w.WriteHeader(status)
			}))
			defer upstream.Close()
			resolver := sessionResolver(upstream.URL, "internal-fixture", func(context.Context, identity.Claims) (identity.Principal, bool, error) {
				return identity.Principal{}, false, nil
			}, func(context.Context, identity.Claims) (identity.Principal, error) {
				calls++
				return identity.Principal{UserID: "owner"}, nil
			})
			principal, err := resolver(context.Background(), identity.Claims{Subject: "subject", SessionID: "session"})
			switch status {
			case 204:
				if err != nil || principal.UserID != "owner" || calls != 1 {
					t.Fatalf("valid identity failed: %v %v", principal, err)
				}
			case 401, 403:
				if !errors.Is(err, identity.ErrUnauthorized) || calls != 0 {
					t.Fatalf("revoked session accepted/misclassified: %v", err)
				}
			default:
				if !errors.Is(err, identity.ErrUnavailable) || calls != 0 {
					t.Fatalf("dependency failure invalidated session: %v", err)
				}
			}
		})
	}
}

func TestSessionResolverOverlapsReadAndVerification(t *testing.T) {
	started := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-started:
			w.WriteHeader(http.StatusNoContent)
		case <-time.After(time.Second):
			t.Error("identity read did not overlap verification")
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer upstream.Close()
	resolver := sessionResolver(upstream.URL, "secret", func(context.Context, identity.Claims) (identity.Principal, bool, error) {
		close(started)
		return identity.Principal{UserID: "owner"}, true, nil
	}, func(context.Context, identity.Claims) (identity.Principal, error) {
		t.Error("unchanged identity unexpectedly projected")
		return identity.Principal{}, nil
	})
	p, err := resolver(context.Background(), identity.Claims{SessionID: "session"})
	if err != nil || p.UserID != "owner" {
		t.Fatalf("resolution failed: %v %v", p, err)
	}
}

func TestSessionResolverNetworkFailureDeniesWithoutInvalidatingSession(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	upstream.Close()
	resolver := sessionResolver(upstream.URL, "internal-fixture", func(context.Context, identity.Claims) (identity.Principal, bool, error) {
		return identity.Principal{}, false, nil
	}, func(context.Context, identity.Claims) (identity.Principal, error) {
		t.Fatal("resolved identity without session verification")
		return identity.Principal{}, nil
	})
	if _, err := resolver(context.Background(), identity.Claims{SessionID: "session"}); !errors.Is(err, identity.ErrUnavailable) {
		t.Fatalf("expected temporary denial, got %v", err)
	}
}
