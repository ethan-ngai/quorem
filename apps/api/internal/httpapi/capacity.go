package httpapi

import (
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
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
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
