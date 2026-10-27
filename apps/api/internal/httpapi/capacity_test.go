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
				r.URL.Path = "/v1/interviews/e994c7a7-642b-4f38-a1ed-000000000194/events"
				r.Header.Set("Upgrade", "websocket")
				r.Header.Set("Connection", "keep-alive, Upgrade")
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
			r.URL.Path = "/v1/interviews/e994c7a7-642b-4f38-a1ed-000000000194/events"
			r.Header.Set("Upgrade", "websocket")
			r.Header.Set("Connection", "keep-alive, Upgrade")
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

func TestUpgradeHeaderCannotBypassHTTPBudget(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	handler := WithCapacity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release }), 1, 4)
	go func() {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/v1/submissions", nil))
		close(done)
	}()
	<-entered
	for _, route := range []struct{ method, path string }{{"POST", "/v1/submissions"}, {"GET", "/v1/session"}, {"POST", "/v1/interviews/e994c7a7-642b-4f38-a1ed-000000000194/events"}} {
		r := httptest.NewRequest(route.method, route.path, nil)
		r.Header.Set("Upgrade", "websocket")
		r.Header.Set("Connection", "upgrade")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 503 {
			t.Fatal("upgrade header bypassed HTTP budget")
		}
	}
	close(release)
	<-done
}

func TestSubmissionUpgradeUsesSocketBudget(t *testing.T) {
	r := httptest.NewRequest("GET", "/v1/submissions/e994c7a7-642b-4f38-a1ed-000000000194/events", nil)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Connection", "upgrade")
	if !realtimeUpgrade(r) {
		t.Fatal("submission socket uses HTTP capacity")
	}
}

func TestCurrentMatchEventUpgradeUsesSocketBudget(t *testing.T) {
	r := httptest.NewRequest("GET", "/v1/memberships/events", nil)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Connection", "keep-alive, Upgrade")
	if !realtimeUpgrade(r) {
		t.Fatal("membership socket consumed HTTP capacity")
	}
	r.Method = "POST"
	if realtimeUpgrade(r) {
		t.Fatal("non-GET admitted as socket")
	}
}
