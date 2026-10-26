package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCapacitySeparatesSocketsAndRequests(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	handler := WithCapacity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		entered <- struct{}{}
		<-release
		w.WriteHeader(204)
	}), 1, 1)
	done := make(chan struct{}, 2)
	start := func(socket bool) {
		go func() {
			r := httptest.NewRequest("GET", "/work", nil)
			if socket {
				r.Header.Set("Upgrade", "websocket")
			}
			handler.ServeHTTP(httptest.NewRecorder(), r)
			done <- struct{}{}
		}()
		<-entered
	}
	start(false)
	start(true)
	for _, socket := range []bool{false, true} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/work", nil)
		if socket {
			r.Header.Set("Upgrade", "websocket")
		}
		handler.ServeHTTP(w, r)
		if w.Code != 503 || w.Header().Get("Retry-After") != "1" {
			t.Fatalf("unbounded overload: %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 {
		t.Fatal("health blocked")
	}
	close(release)
	<-done
	<-done
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/work", nil))
	if w.Code != 204 {
		t.Fatal("slot not released")
	}
}
