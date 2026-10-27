package httpapi

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const guestCookie = "quorem_guest"

func (s *Server) guestOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || !s.allowedOrigin(origin) {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Origin denied"})
		return false
	}
	return true
}
func (s *Server) bootstrapGuest(w http.ResponseWriter, r *http.Request) {
	if !s.GuestAdmission {
		s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Guest admission is temporarily paused"})
		return
	}
	if !s.guestOrigin(w, r) {
		return
	}
	if c, err := r.Cookie(guestCookie); err == nil && identity.ValidGuestToken(c.Value) {
		w.WriteHeader(204)
		return
	}
	credential, err := identity.NewGuestToken()
	if err != nil {
		s.err(w, r, err)
		return
	}
	origin, _ := url.Parse(r.Header.Get("Origin"))
	ip := net.ParseIP(origin.Hostname())
	loopback := origin.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	setGuestCookie(w, guestCookie, credential, !loopback || origin.Scheme == "https")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(204)
}

func setGuestCookie(w http.ResponseWriter, name, value string, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: 86400})
}
func (s *Server) joinGuest(w http.ResponseWriter, r *http.Request) {
	if !s.GuestAdmission {
		s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Guest admission is temporarily paused"})
		return
	}
	if !s.guestOrigin(w, r) {
		return
	}
	if identity.Subject(r.Context()).UserID != "" && !identity.Subject(r.Context()).Guest {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Use your account to join"})
		return
	}
	cookie, err := r.Cookie(guestCookie)
	if err != nil {
		s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Start a guest session first"})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !s.decode(w, r, &body, 512) {
		return
	}
	v, err := s.Store.JoinGuest(r.Context(), r.PathValue("token"), cookie.Value, body.Name)
	if err != nil {
		s.err(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, 200, v)
}
func guestRoute(r *http.Request, p identity.Principal, public bool) bool {
	if public {
		return true
	}
	path := r.URL.Path
	if path == "/v1/guest-sessions/end" && r.Method == "POST" {
		return true
	}
	if r.Method == "GET" && (path == "/v1/session" || path == "/v1/matches/current" || strings.HasPrefix(path, "/v1/workspaces/") || strings.HasPrefix(path, "/v1/submissions/")) {
		return true
	}
	if r.Method == "POST" && (path == "/v1/submissions" || (strings.HasPrefix(path, "/v1/submissions/") && strings.HasSuffix(path, "/cancel"))) {
		return true
	}
	base := "/v1/matches/" + p.MatchID
	if path == base {
		return r.Method == "GET"
	}
	for _, suffix := range []string{"/events", "/ready", "/leave", "/forfeit", "/rule-events", "/workspace-language"} {
		if path == base+suffix {
			return true
		}
	}
	return false
}
func (s *Server) getCapabilities(w http.ResponseWriter, r *http.Request) {
	p := identity.Subject(r.Context())
	if p.Guest {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "An account is required"})
		return
	}
	c, err := s.Store.Capabilities(r.Context(), owner(r))
	if err != nil {
		s.err(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, 200, c)
}
func (s *Server) rotateInvite(w http.ResponseWriter, r *http.Request) {
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	v, err := s.Store.RotateInvite(r.Context(), owner(r), r.PathValue("id"), key)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}
func (s *Server) removeGuest(w http.ResponseWriter, r *http.Request) {
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	v, err := s.Store.RemoveGuest(r.Context(), owner(r), r.PathValue("id"), r.PathValue("guest"), key)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}

func clearGuestCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: guestCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
}
func (s *Server) endGuest(w http.ResponseWriter, r *http.Request) {
	if !identity.Subject(r.Context()).Guest {
		s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Guest session required"})
		return
	}
	cookie, _ := r.Cookie(guestCookie)
	if cookie == nil {
		w.WriteHeader(401)
		return
	}
	ended, err := s.Store.EndGuestSession(r.Context(), cookie.Value)
	if err != nil {
		s.err(w, r, err)
		return
	}
	if !ended {
		s.err(w, r, &application.Error{Code: "invalid_transition", Status: 409, Message: "The guest match is still active"})
		return
	}
	clearGuestCookie(w)
	w.WriteHeader(204)
}
