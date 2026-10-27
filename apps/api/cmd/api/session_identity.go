package main

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

// Dependency failures deny the request without telling clients their session was revoked.
func sessionResolver(authURL, secret string, lookup func(context.Context, identity.Claims) (identity.Principal, bool, error), resolve identity.Resolver) identity.Resolver {
	return func(ctx context.Context, c identity.Claims) (identity.Principal, error) {
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		type result struct {
			principal identity.Principal
			current   bool
			err       error
		}
		read := make(chan result, 1)
		go func() { p, current, err := lookup(ctx, c); read <- result{p, current, err} }()
		req, err := http.NewRequestWithContext(ctx, "GET", authURL+"/internal/session/"+c.SessionID, nil)
		if err != nil {
			return identity.Principal{}, identity.ErrUnavailable
		}
		req.Header.Set("Authorization", "Bearer "+secret)
		req.Header.Set("X-Auth-Subject", c.Subject)
		response, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
		if err != nil {
			return identity.Principal{}, identity.ErrUnavailable
		}
		response.Body.Close()
		switch response.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return identity.Principal{}, identity.ErrUnauthorized
		case http.StatusNoContent:
		default:
			return identity.Principal{}, identity.ErrUnavailable
		}
		checked := <-read
		p, err := checked.principal, checked.err
		if err == nil && !checked.current {
			p, err = resolve(ctx, c)
		}
		if at, e := strconv.ParseInt(response.Header.Get("X-Auth-Strong-At"), 10, 64); e == nil && at <= time.Now().Unix() && at > time.Now().Add(-10*time.Minute).Unix() {
			p.StrongUntil = at + 600
		}
		return p, err
	}
}
