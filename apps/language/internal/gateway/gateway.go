package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

type Config struct {
	Address, WebOrigin, AuthOrigin, IdentityURL string
	DevIdentity                                 bool
	HostedEnabled                               bool
	MaxSessions                                 int
	IdleTimeout                                 time.Duration
	Factory                                     EngineFactory
	HTTPClient                                  *http.Client
}
type Gateway struct {
	config      Config
	mu          sync.Mutex
	sessions    map[string]*session
	admissions  map[string]uint64
	sequence    uint64
	closing     bool
	connections sync.WaitGroup
	upgrades    chan struct{}
}
type session struct {
	owner        string
	conn         *websocket.Conn
	ctx          context.Context
	cancel       context.CancelFunc
	done         chan struct{}
	engine       Engine
	cleanupErr   error
	cleanupMu    sync.Mutex
	cleaned      bool
	closeOnce    sync.Once
	lastActivity atomic.Int64
}

func New(config Config) (*Gateway, error) {
	if config.MaxSessions == 0 {
		config.MaxSessions = 8
	}
	if config.IdleTimeout == 0 {
		config.IdleTimeout = 5 * time.Minute
	}
	if config.MaxSessions < 1 || config.MaxSessions > 256 || config.IdleTimeout < time.Second {
		return nil, errors.New("invalid session limits")
	}
	if config.WebOrigin == "" {
		config.WebOrigin = "http://localhost:5173"
	}
	origin, err := url.Parse(config.WebOrigin)
	if err != nil || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || origin.Scheme != "http" && origin.Scheme != "https" {
		return nil, errors.New("invalid web origin")
	}
	if config.DevIdentity && (origin.Scheme != "http" || (origin.Hostname() != "localhost" && origin.Hostname() != "127.0.0.1")) {
		return nil, errors.New("development origin must be loopback")
	}
	if config.HostedEnabled && !config.DevIdentity && (config.AuthOrigin == "" || config.IdentityURL == "") {
		return nil, errors.New("managed identity configuration required")
	}
	if config.Factory == nil {
		config.Factory = DockerFactory{Address: config.Address}
	}
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{Timeout: 3 * time.Second}
	}
	return &Gateway{config: config, sessions: map[string]*session{}, admissions: map[string]uint64{}, upgrades: make(chan struct{}, config.MaxSessions*2)}, nil
}
func (g *Gateway) owner(r *http.Request) string {
	if r.URL.Path != "/lsp" {
		return ""
	}
	protocols := r.Header.Get("Sec-WebSocket-Protocol")
	if g.config.DevIdentity {
		_, hasAuthorization := r.Header["Authorization"]
		if hasAuthorization || strings.Contains(protocols, "bearer.") {
			return ""
		}
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			return ""
		}
		if r.Header.Get("Origin") != g.config.WebOrigin && r.Header.Get("Origin") != "http://localhost:5173" && r.Header.Get("Origin") != "http://127.0.0.1:5173" {
			return ""
		}
		owner := r.URL.Query().Get("user")
		switch owner {
		case "alice", "bob", "charlie", "dana":
			return owner
		}
		return ""
	}
	if r.Header.Get("Origin") != g.config.AuthOrigin {
		return ""
	}
	bearer := ""
	for _, protocol := range strings.Split(protocols, ",") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(protocol), "bearer."); ok {
			bearer = value
			break
		}
	}
	if bearer == "" || len(bearer) > 16384 {
		return ""
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(g.config.IdentityURL, "/")+"/v1/session", nil)
	if err != nil {
		return ""
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err := g.config.HTTPClient.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ""
	}
	var data struct {
		Mode         string `json:"mode"`
		Capabilities struct {
			Hosted bool `json:"hostedIntelligence"`
		} `json:"capabilities"`
		User struct {
			ID       string `json:"id"`
			Verified bool   `json:"emailVerified"`
		} `json:"user"`
	}
	if json.NewDecoder(http.MaxBytesReader(nil, response.Body, 64*1024)).Decode(&data) != nil || data.Mode != "managed" || !data.User.Verified || !data.Capabilities.Hosted {
		return ""
	}
	return data.User.ID
}
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		g.mu.Lock()
		count, closing := len(g.sessions), g.closing
		g.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		status := "ok"
		if closing {
			status = "draining"
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "service": "language", "gateway": "go", "hostedEnabled": g.config.HostedEnabled, "reservedSessions": count, "capacity": g.config.MaxSessions})
		return
	}
	if r.URL.Path != "/lsp" {
		http.NotFound(w, r)
		return
	}
	// The server switch is authoritative, regardless of browser flags or credentials.
	if !g.config.HostedEnabled {
		http.NotFound(w, r)
		return
	}
	if language := r.URL.Query().Get("language"); language != "" && language != "python" {
		http.Error(w, "Language unavailable", http.StatusBadRequest)
		return
	}
	// Bound all connections, including pending upgrades, before identity calls or containers.
	select {
	case g.upgrades <- struct{}{}:
		defer func() { <-g.upgrades }()
	default:
		http.Error(w, "Language capacity reached", http.StatusServiceUnavailable)
		return
	}
	g.mu.Lock()
	if g.closing {
		g.mu.Unlock()
		http.Error(w, "Service shutting down", http.StatusServiceUnavailable)
		return
	}
	g.connections.Add(1)
	g.mu.Unlock()
	defer g.connections.Done()
	owner := g.owner(r)
	if owner == "" {
		http.Error(w, "Sign in required", http.StatusForbidden)
		return
	}
	// Origin is checked above against the configured application, before upgrade.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, Subprotocols: []string{"quorem"}})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessage)
	ctx, cancel := context.WithCancel(r.Context())
	s := &session{owner: owner, conn: conn, ctx: ctx, cancel: cancel, done: make(chan struct{})}
	s.lastActivity.Store(time.Now().UnixNano())
	defer cancel()
	defer conn.CloseNow()
	messages := make(chan []byte, 1)
	go func() {
		defer cancel()
		defer close(messages)
		for {
			kind, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if kind != websocket.MessageText || validateMessage(data) != nil {
				s.stop(1008, "Invalid language request")
				return
			}
			s.lastActivity.Store(time.Now().UnixNano())
			select {
			case messages <- data:
			case <-ctx.Done():
				return
			}
		}
	}()
	if !g.admit(s, r.URL.Query().Get("takeover") == "1") {
		return
	}
	defer g.finish(s)
	go g.watch(s, r)
	engine, err := g.config.Factory.Start(ctx, owner)
	s.engine = engine
	if err != nil || ctx.Err() != nil {
		s.stop(1011, "Language engine unavailable")
		return
	}
	go func() {
		defer s.stop(1000, "Language session closed")
		reader := bufio.NewReaderSize(engine.Output(), 4096)
		for {
			data, err := readFrame(reader)
			if err != nil {
				return
			}
			writeCtx, done := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Write(writeCtx, websocket.MessageText, data)
			done()
			if err != nil {
				return
			}
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-messages:
			if !ok {
				return
			}
			if writeFrame(engine.Input(), data) != nil {
				s.stop(1011, "Language input unavailable")
				return
			}
		}
	}
}
func (s *session) stop(code int, reason string) {
	s.closeOnce.Do(func() {
		timer := time.AfterFunc(250*time.Millisecond, func() { _ = s.conn.CloseNow() })
		_ = s.conn.Close(websocket.StatusCode(code), reason)
		timer.Stop()
		s.cancel()
	})
}
func (g *Gateway) admit(s *session, takeover bool) bool {
	g.mu.Lock()
	prior := g.sessions[s.owner]
	if g.closing {
		g.mu.Unlock()
		s.stop(1001, "Service shutting down")
		return false
	}
	if prior != nil && prior.ctx.Err() == nil && !takeover {
		g.mu.Unlock()
		s.stop(4009, "Language session already active; explicit takeover required")
		return false
	}
	g.sequence++
	generation := g.sequence
	g.admissions[s.owner] = generation
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		if g.admissions[s.owner] == generation {
			delete(g.admissions, s.owner)
		}
		g.mu.Unlock()
	}()
	if prior != nil {
		prior.stop(4009, "Editor session replaced")
		select {
		case <-prior.done:
		case <-s.ctx.Done():
			return false
		}
		if g.cleanup(prior) != nil {
			s.stop(1011, "Previous language engine cleanup failed")
			return false
		}
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closing || s.ctx.Err() != nil || g.admissions[s.owner] != generation {
		s.stop(4009, "Language session unavailable")
		return false
	}
	if len(g.sessions) >= g.config.MaxSessions {
		s.stop(1013, "Language capacity reached. Try again shortly.")
		return false
	}
	g.sessions[s.owner] = s
	return true
}
func (g *Gateway) cleanup(s *session) error {
	s.cleanupMu.Lock()
	defer s.cleanupMu.Unlock()
	if !s.cleaned {
		if s.engine != nil {
			for attempt := 0; attempt < 3; attempt++ {
				s.cleanupErr = s.engine.Close()
				if s.cleanupErr == nil {
					break
				}
				time.Sleep(time.Duration(attempt+1) * 50 * time.Millisecond)
			}
		}
		if s.cleanupErr != nil {
			return s.cleanupErr
		}
		s.cleaned = true
	}
	g.mu.Lock()
	if g.sessions[s.owner] == s {
		delete(g.sessions, s.owner)
	}
	g.mu.Unlock()
	return nil
}
func (g *Gateway) finish(s *session) {
	s.stop(1000, "Language session closed")
	_ = g.cleanup(s)
	close(s.done)
}
func (g *Gateway) watch(s *session, r *http.Request) {
	interval := g.config.IdleTimeout / 4
	if interval > 15*time.Second {
		interval = 15 * time.Second
	}
	idle := time.NewTicker(interval)
	defer idle.Stop()
	auth := time.NewTicker(15 * time.Second)
	defer auth.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-idle.C:
			if time.Since(time.Unix(0, s.lastActivity.Load())) >= g.config.IdleTimeout {
				s.stop(4008, "Language session idle")
				return
			}
		case <-auth.C:
			if !g.config.DevIdentity && g.owner(r) != s.owner {
				s.stop(1008, "Sign in required")
				return
			}
		}
	}
}

// Shutdown refuses new owners and waits for every startup and teardown to complete.
func (g *Gateway) Shutdown(ctx context.Context) error {
	g.mu.Lock()
	g.closing = true
	active := make([]*session, 0, len(g.sessions))
	for _, s := range g.sessions {
		active = append(active, s)
	}
	g.mu.Unlock()
	for _, s := range active {
		go s.stop(1001, "Service shutting down")
	}
	done := make(chan struct{})
	go func() { g.connections.Wait(); close(done) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.sessions) > 0 {
		return fmt.Errorf("%d engines require cleanup", len(g.sessions))
	}
	return nil
}
