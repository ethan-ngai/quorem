package httpapi

import (
	"encoding/base64"
	"net/http"
	"strings"
)

// Bound in-flight work per replica; socket lifetimes use an independent budget.
func WithCapacity(next http.Handler, requests, sockets int) http.Handler {
	if requests < 1 || sockets < 1 {
		panic("invalid API capacity")
	}
	httpSlots := make(chan struct{}, requests)
	socketSlots := make(chan struct{}, sockets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		slots := httpSlots
		if realtimeUpgrade(r) {
			slots = socketSlots
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"temporarily_unavailable","message":"Service busy. Try again shortly."}}`))
		}
	})
}

// Only authorized event endpoints can hold the separate long-lived socket budget.
func realtimeUpgrade(r *http.Request) bool {
	if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 5 || parts[1] != "v1" || parts[4] != "events" {
		return false
	}
	decoded, decodeErr := base64.RawURLEncoding.DecodeString(parts[3])
	invite := parts[2] == "match-invites" && decodeErr == nil && len(decoded) == 32
	if !invite && !((parts[2] == "interviews" || parts[2] == "matches") && uuid.MatchString(parts[3])) {
		return false
	}
	for _, header := range r.Header.Values("Connection") {
		for _, token := range strings.Split(header, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				return true
			}
		}
	}
	return false
}
