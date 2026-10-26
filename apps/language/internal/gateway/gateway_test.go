package gateway

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type discardInput struct{ io.Writer }

func (discardInput) Close() error { return nil }

type fakeEngine struct {
	output *io.PipeReader
	writer *io.PipeWriter
	once   sync.Once
}

func (e *fakeEngine) Input() io.WriteCloser { return discardInput{io.Discard} }
func (e *fakeEngine) Output() io.Reader     { return e.output }
func (e *fakeEngine) Close() error {
	e.once.Do(func() { _ = e.writer.Close(); _ = e.output.Close() })
	return nil
}

type fakeFactory struct {
	mu      sync.Mutex
	starts  int
	failure bool
}

func (f *fakeFactory) Start(ctx context.Context, owner string) (Engine, error) {
	f.mu.Lock()
	f.starts++
	fail := f.failure
	f.mu.Unlock()
	if fail {
		return nil, errors.New("private runtime failure")
	}
	r, w := io.Pipe()
	return &fakeEngine{output: r, writer: w}, nil
}
func setup(t *testing.T, capacity int, idle time.Duration) (*Gateway, string, *fakeFactory) {
	t.Helper()
	f := &fakeFactory{}
	g, err := New(Config{HostedEnabled: true, DevIdentity: true, MaxSessions: capacity, IdleTimeout: idle, Factory: f})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := g.Shutdown(ctx); err != nil {
			t.Error(err)
		}
		server.Close()
	})
	return g, "ws" + strings.TrimPrefix(server.URL, "http") + "/lsp", f
}
func dial(t *testing.T, address, owner string, takeover bool) *websocket.Conn {
	t.Helper()
	if takeover {
		owner += "&takeover=1"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var conn *websocket.Conn
	for {
		var response *http.Response
		var err error
		conn, response, err = websocket.Dial(ctx, address+"?user="+owner, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}}})
		if err == nil {
			break
		}
		// A preceding close frame can arrive before its handler releases its slot.
		if response == nil || response.StatusCode != http.StatusServiceUnavailable || ctx.Err() != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}
func closed(t *testing.T, c *websocket.Conn, code websocket.StatusCode) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if got := websocket.CloseStatus(err); got != code {
		t.Fatalf("close %d, want %d: %v", got, code, err)
	}
}
func waitCount(t *testing.T, g *Gateway, n int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		g.mu.Lock()
		count := len(g.sessions)
		g.mu.Unlock()
		if count == n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("sessions did not reach %d", n)
}

// Counts cannot distinguish a retained old reservation from its admitted replacement.
func waitReplacement(t *testing.T, g *Gateway, owner string, prior *session) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		g.mu.Lock()
		current := g.sessions[owner]
		g.mu.Unlock()
		if current != nil && current != prior {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("replacement session was not admitted")
}

func TestAdmissionAndTakeover(t *testing.T) {
	g, address, _ := setup(t, 1, time.Minute)
	first := dial(t, address, "alice", false)
	waitCount(t, g, 1)
	duplicate := dial(t, address, "alice", false)
	closed(t, duplicate, 4009)
	excess := dial(t, address, "bob", false)
	closed(t, excess, 1013)
	g.mu.Lock()
	prior := g.sessions["alice"]
	g.mu.Unlock()
	replacement := dial(t, address, "alice", true)
	closed(t, first, 4009)
	waitReplacement(t, g, "alice", prior)
	_ = replacement.CloseNow()
	waitCount(t, g, 0)
}
func TestIdleAndInvalidInput(t *testing.T) {
	g, address, _ := setup(t, 1, time.Second)
	idle := dial(t, address, "alice", false)
	closed(t, idle, 4008)
	waitCount(t, g, 0)
	invalid := dial(t, address, "bob", false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = invalid.Write(ctx, websocket.MessageText, []byte(`{"jsonrpc":"2.0","method":"workspace/executeCommand"}`))
	closed(t, invalid, 1008)
	waitCount(t, g, 0)
}
func TestStartupFailureReleasesCapacity(t *testing.T) {
	g, address, f := setup(t, 1, time.Minute)
	f.mu.Lock()
	f.failure = true
	f.mu.Unlock()
	failed := dial(t, address, "alice", false)
	closed(t, failed, 1011)
	waitCount(t, g, 0)
}
func TestManagedIdentity(t *testing.T) {
	identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/session" || r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(401)
			return
		}
		_, _ = io.WriteString(w, `{"capabilities":{"hostedIntelligence":true},"mode":"managed","user":{"id":"real-owner","emailVerified":true}}`)
	}))
	defer identity.Close()
	g, err := New(Config{HostedEnabled: true, WebOrigin: "https://app.example", AuthOrigin: "https://app.example", IdentityURL: identity.URL})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "http://gateway/lsp?user=forged", nil)
	r.Header.Set("Origin", "https://app.example")
	r.Header.Set("Sec-WebSocket-Protocol", "quorem, bearer.secret")
	if g.owner(r) != "real-owner" {
		t.Fatal("managed identity not resolved")
	}
	r.Header.Set("Origin", "https://evil.example")
	if g.owner(r) != "" {
		t.Fatal("foreign origin accepted")
	}
	r.Header.Set("Origin", "https://app.example")
	r.Header.Set("Sec-WebSocket-Protocol", "quorem, bearer.revoked")
	if g.owner(r) != "" {
		t.Fatal("revoked credential accepted")
	}
}
func TestShutdown(t *testing.T) {
	g, address, _ := setup(t, 1, time.Minute)
	c := dial(t, address, "alice", false)
	waitCount(t, g, 1)
	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		done <- g.Shutdown(ctx)
	}()
	closed(t, c, websocket.StatusGoingAway)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	g.ServeHTTP(response, httptest.NewRequest("GET", "/health", nil))
	if response.Code != 503 {
		t.Fatal(response.Code)
	}
}
func TestProtocolBoundaries(t *testing.T) {
	valid := []byte(`{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///workspace/main.py","text":"你好"}}}`)
	if err := validateMessage(valid); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`[]`, `{"jsonrpc":"1.0"}`, `{"jsonrpc":"2.0","method":"workspace/executeCommand"}`, `{"jsonrpc":"2.0","method":"initialize","params":{"rootUri":"file:///etc/passwd"}}`} {
		if validateMessage([]byte(body)) == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	var buffer bytes.Buffer
	if err := writeFrame(&buffer, valid); err != nil {
		t.Fatal(err)
	}
	got, err := readFrame(bufio.NewReader(&buffer))
	if err != nil || !bytes.Equal(got, valid) {
		t.Fatalf("unicode framing: %v", err)
	}
	for _, frame := range []string{"Content-Length: 999999999\r\n\r\n", "Content-Length: -1\r\n\r\n", "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}", "Content-Length: 2\n\n{}", "\r\n{}", "Content-Length: 2\r\n\r\nxx", strings.Repeat("x", 5000) + "\r\n\r\n"} {
		if _, err := readFrame(bufio.NewReaderSize(strings.NewReader(frame), 4096)); err == nil {
			t.Fatal("accepted malformed frame")
		}
	}
}

type factoryFunc func(context.Context, string) (Engine, error)

func (f factoryFunc) Start(ctx context.Context, owner string) (Engine, error) { return f(ctx, owner) }

type failingCleanup struct {
	Engine
	mu       sync.Mutex
	fail     bool
	attempts int
}

func (e *failingCleanup) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.attempts++
	if e.fail {
		return errors.New("cleanup unavailable")
	}
	return e.Engine.Close()
}
func TestFailedCleanupRetainsReservationAndRetries(t *testing.T) {
	g, address, f := setup(t, 1, time.Minute)
	base, _ := f.Start(context.Background(), "alice")
	e := &failingCleanup{Engine: base, fail: true}
	g.config.Factory = factoryFunc(func(context.Context, string) (Engine, error) { return e, nil })
	first := dial(t, address, "alice", false)
	waitCount(t, g, 1)
	g.mu.Lock()
	s := g.sessions["alice"]
	g.mu.Unlock()
	_ = first.CloseNow()
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		t.Fatal("cleanup stuck")
	}
	waitCount(t, g, 1)
	denied := dial(t, address, "bob", false)
	closed(t, denied, 1013)
	e.mu.Lock()
	e.fail = false
	e.mu.Unlock()
	g.config.Factory = f
	replacement := dial(t, address, "alice", true)
	waitReplacement(t, g, "alice", s)
	_ = replacement.CloseNow()
	waitCount(t, g, 0)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.attempts < 4 {
		t.Fatal("cleanup not retried")
	}
}
func TestDisconnectDuringStartupCleansReturnedEngine(t *testing.T) {
	g, address, f := setup(t, 1, time.Minute)
	started := make(chan struct{})
	cleaned := make(chan struct{})
	g.config.Factory = factoryFunc(func(ctx context.Context, owner string) (Engine, error) {
		close(started)
		<-ctx.Done()
		e, _ := f.Start(ctx, owner)
		return &cleanupSignal{Engine: e, done: cleaned}, ctx.Err()
	})
	c := dial(t, address, "alice", false)
	<-started
	_ = c.CloseNow()
	select {
	case <-cleaned:
	case <-time.After(3 * time.Second):
		t.Fatal("late engine leaked")
	}
	waitCount(t, g, 0)
}

type cleanupSignal struct {
	Engine
	done chan struct{}
}

func (e *cleanupSignal) Close() error { err := e.Engine.Close(); close(e.done); return err }

func TestHostedDisabledByDefault(t *testing.T) {
	factory := &fakeFactory{}
	g, err := New(Config{Factory: factory})
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"", "?user=alice&takeover=1", "?language=python"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest("GET", "/lsp"+query, nil)
		request.Header.Set("Origin", "http://localhost:5173")
		request.Header.Set("Sec-WebSocket-Protocol", "quorem, bearer.secret")
		g.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("disabled status = %d", response.Code)
		}
	}
	factory.mu.Lock()
	defer factory.mu.Unlock()
	if factory.starts != 0 || len(g.sessions) != 0 {
		t.Fatal("disabled gateway allocated a worker")
	}
}
