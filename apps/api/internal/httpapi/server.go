package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Server struct {
	PublicGuestRequest   func(context.Context, string) (bool, error)
	GuestCreation        bool
	GuestAdmission       bool
	GuestExecution       bool
	NotifyExecution      func(context.Context, string) error
	RequireExecutionWake bool
	Store                Repository
	Events               realtime.PubSub
	Presence             realtime.Presence
	Identity             identity.Verifier
	Origins              []string
	Local                bool
}

var sourceHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /v1/session", s.session)
	mux.HandleFunc("GET /v1/capabilities", s.getCapabilities)
	mux.HandleFunc("POST /v1/guest-sessions", s.bootstrapGuest)
	mux.HandleFunc("POST /v1/guest-sessions/end", s.endGuest)
	mux.HandleFunc("POST /v1/match-invites/{token}/guest", s.joinGuest)
	mux.HandleFunc("GET /v1/problems", s.listProblems)
	mux.HandleFunc("GET /v1/problems/{slug}", s.problem)
	mux.HandleFunc("GET /v1/problem-versions/{id}", s.problem)
	mux.HandleFunc("POST /v1/workspaces", s.createWorkspace)
	mux.HandleFunc("GET /v1/workspaces/{id}", s.getWorkspace)
	mux.HandleFunc("POST /v1/submissions", s.admit)
	mux.HandleFunc("GET /v1/submissions/{id}", s.submission)
	mux.HandleFunc("POST /v1/submissions/{id}/cancel", s.cancel)
	mux.HandleFunc("POST /v1/matches", s.createMatch)
	mux.HandleFunc("GET /v1/matches/current", s.currentMatch)
	mux.HandleFunc("GET /v1/memberships/events", s.currentMatchEvents)
	mux.HandleFunc("GET /v1/match-invites/{token}", s.previewInvite)
	mux.HandleFunc("GET /v1/match-invites/{token}/events", s.previewInviteEvents)
	mux.HandleFunc("POST /v1/matches/join", s.joinMatch)
	mux.HandleFunc("POST /v1/matches/{id}/rotate-invite", s.rotateInvite)
	mux.HandleFunc("POST /v1/matches/{id}/guests/{guest}/remove", s.removeGuest)
	mux.HandleFunc("GET /v1/matches/{id}", s.getMatch)
	for _, action := range []string{"ready", "forfeit", "leave", "start", "rule-events"} {
		a := action
		mux.HandleFunc("POST /v1/matches/{id}/"+a, func(w http.ResponseWriter, r *http.Request) { r.SetPathValue("action", a); s.mutateMatch(w, r) })
	}
	mux.HandleFunc("PUT /v1/matches/{id}/settings", func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("action", "settings")
		s.mutateMatch(w, r)
	})
	s.registerInterviews(mux)
	s.registerMatchLanguages(mux)
	s.registerAdminQuestions(mux)
	s.registerOdyssey(mux)
	s.registerEditorials(mux)
	s.registerRealtime(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := application.ID()
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			u := strings.TrimSuffix(origin, "/")
			if !s.allowedOrigin(u) {
				s.err(w, r, &application.Error{Code: "forbidden", Message: "Origin denied", Status: 403})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", u)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Dev-User, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		r.Header.Del("X-Quorem-Owner")
		public := r.URL.Path == "/health" || (r.Method == "GET" && (r.URL.Path == "/v1/problems" || strings.HasPrefix(r.URL.Path, "/v1/problems/") || strings.HasPrefix(r.URL.Path, "/v1/problem-versions/") || strings.HasPrefix(r.URL.Path, "/v1/match-invites/")))
		public = public || interviewPath(r.URL.Path)
		public = public || (r.Method == "POST" && (r.URL.Path == "/v1/guest-sessions" || (strings.HasPrefix(r.URL.Path, "/v1/match-invites/") && strings.HasSuffix(r.URL.Path, "/guest"))))
		if s.PublicGuestRequest != nil && (strings.HasPrefix(r.URL.Path, "/v1/match-invites/") || strings.HasPrefix(r.URL.Path, "/v1/interview-invites/") || r.URL.Path == "/v1/guest-sessions") {
			peer, _, _ := net.SplitHostPort(r.RemoteAddr)
			allowed, err := s.PublicGuestRequest(r.Context(), peer)
			if err != nil {
				s.err(w, r, err)
				return
			}
			if !allowed {
				s.err(w, r, &application.Error{Code: "rate_limited", Status: 429, Message: "Too many invitation requests; try again shortly"})
				return
			}
		}
		bearer, credentialErr := requestBearer(r)
		if credentialErr != nil {
			s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Invalid credentials", Status: 401})
			return
		}
		if bearer != "" && s.Identity == nil {
			s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Managed identity unavailable", Status: 401})
			return
		}
		if s.Identity != nil && bearer != "" {
			principal, err := s.Identity.Verify(r.Context(), bearer)
			if err != nil {
				if !errors.Is(err, identity.ErrUnauthorized) {
					s.err(w, r, identity.ErrUnavailable)
					return
				}
				s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Sign in required", Status: 401})
				return
			}
			r = r.WithContext(identity.With(r.Context(), principal))
			r.Header.Set("X-Quorem-Owner", principal.UserID)
		} else if cookie, e := r.Cookie(interviewGuestCookie); e == nil && interviewPath(r.URL.Path) && s.Store != nil {
			repo, ok := s.Store.(InterviewRepository)
			if !ok {
				s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Interviews unavailable"})
				return
			}
			p, e := repo.InterviewGuestIdentity(r.Context(), cookie.Value)
			if e != nil && !errors.Is(e, identity.ErrUnauthorized) {
				s.err(w, r, identity.ErrUnavailable)
				return
			}
			if e == nil {
				if r.Method != "GET" && !s.guestOrigin(w, r) {
					return
				}
				r = r.WithContext(identity.With(r.Context(), p))
				r.Header.Set("X-Quorem-Owner", p.UserID)
			}
		} else if cookie, e := r.Cookie(guestCookie); e == nil && s.Store != nil && !interviewPath(r.URL.Path) {
			p, e := s.Store.GuestIdentity(r.Context(), cookie.Value)
			if e != nil {
				if !errors.Is(e, identity.ErrUnauthorized) {
					s.err(w, r, identity.ErrUnavailable)
					return
				}
				if !public {
					clearGuestCookie(w)
					s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Guest session expired"})
					return
				}
			} else {
				if r.Method != "GET" && !s.guestOrigin(w, r) {
					return
				}
				if !guestRoute(r, p, public) {
					s.err(w, r, &application.Error{Code: "forbidden", Status: 403, Message: "Guest access is limited to your match"})
					return
				}
				r = r.WithContext(identity.With(r.Context(), p))
				r.Header.Set("X-Quorem-Owner", p.UserID)
			}
		} else if s.Local {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil || !net.ParseIP(host).IsLoopback() {
				s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Local development identity unavailable", Status: 401})
				return
			}
			user := r.Header.Get("X-Dev-User")
			if user == "" {
				user = "alice"
			}
			if developmentSubject(user) == "" {
				s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Unknown development identity", Status: 401})
				return
			}
			p := identity.Principal{UserID: user, DisplayName: user, EmailVerified: true, SessionID: "development"}
			if s.Store != nil {
				resolved, err := s.Store.DevelopmentIdentity(r.Context(), user)
				if err != nil {
					s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Identity unavailable", Status: 401})
					return
				}
				p = resolved
			}
			r = r.WithContext(identity.With(r.Context(), p))
			r.Header.Set("X-Quorem-Owner", user)
		} else if !public {
			s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Sign in required", Status: 401})
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func owner(r *http.Request) string { return r.Header.Get("X-Quorem-Owner") }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func (s *Server) err(w http.ResponseWriter, r *http.Request, err error) {
	var typed *application.Error
	code, message, status := "temporarily_unavailable", "Service unavailable", 503
	if errors.As(err, &typed) {
		code, message, status = typed.Code, typed.Message, typed.Status
	}
	if status == 429 {
		w.Header().Set("Retry-After", "6")
	}
	respond(w, status, map[string]any{"error": map[string]string{"code": code, "message": message, "requestId": w.Header().Get("X-Request-ID")}})
}
func (s *Server) decode(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(v)
	if err == nil {
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			err = errors.New("multiple JSON values")
		}
	}
	if err != nil {
		var max *http.MaxBytesError
		status, code := 400, "invalid_input"
		if errors.As(err, &max) {
			status, code = 413, "payload_too_large"
		}
		s.err(w, r, &application.Error{Code: code, Message: "Invalid request body", Status: status})
		return false
	}
	return true
}
func (s *Server) listProblems(w http.ResponseWriter, r *http.Request) {
	filter, e := parseProblemFilter(r.URL.Query())
	if e != nil {
		s.err(w, r, e)
		return
	}
	v, e := s.Store.ProblemCatalog(r.Context(), filter)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) problem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	value := r.PathValue("slug")
	if id != "" {
		value = id
	}
	if id != "" {
		v, e := s.Store.MatchProblem(r.Context(), value)
		if e != nil {
			s.err(w, r, e)
			return
		}
		respond(w, 200, v)
		return
	}
	v, e := s.Store.Problem(r.Context(), value, false)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProblemVersionID string `json:"problemVersionId"`
		Language         string `json:"language"`
	}
	if !s.decode(w, r, &body, 4096) {
		return
	}
	if !uuid.MatchString(body.ProblemVersionID) {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Invalid problem ID", Status: 400})
		return
	}
	v, e := s.Store.CreateWorkspace(r.Context(), owner(r), body.ProblemVersionID, body.Language)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 201, v)
}
func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	v, e := s.Store.Workspace(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func validExecutionCases(kind string, cases []problems.Case) bool {
	if cases == nil {
		return true
	}
	if kind != "run" || len(cases) == 0 || len(cases) > 20 {
		return false
	}
	encoded, err := json.Marshal(cases)
	return err == nil && len(encoded) <= execution.MaxCustomCasesBytes
}
func (s *Server) admit(w http.ResponseWriter, r *http.Request) {
	if identity.Subject(r.Context()).Guest && !s.GuestExecution {
		s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Guest execution is temporarily paused"})
		return
	}
	var body judging.Command
	if !s.decode(w, r, &body, execution.MaxCustomCasesBytes+512*1024) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if !execution.ValidSource(body.Source) {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Source must be valid UTF-8, at most 65536 bytes, and contain no NUL characters", Status: 400})
		return
	}
	if key == "" || len(key) > 128 || !uuid.MatchString(body.WorkspaceID) || (body.Kind != "run" && body.Kind != "submit") || !validExecutionCases(body.Kind, body.CustomCases) {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Invalid execution command", Status: 400})
		return
	}
	canonical, _ := json.Marshal(body)
	ctx, cancel, ok := s.executionAdmission(w, r)
	if !ok {
		return
	}
	defer cancel()
	v, e := s.Store.Admit(ctx, owner(r), key, body, application.Hash(canonical))
	if e != nil {
		s.err(w, r, e)
		return
	}
	if !s.RequireExecutionWake && s.NotifyExecution != nil && v.ExecutionJobID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		if err := s.NotifyExecution(ctx, v.ExecutionJobID); err != nil {
			log.Print("Execution notification unavailable; database polling will recover")
		}
		cancel()
	}
	respond(w, 202, map[string]any{"id": v.ID, "state": v.State, "sourceHash": v.SourceHash, "admittedAt": v.AdmittedAt})
}
func (s *Server) submission(w http.ResponseWriter, r *http.Request) {
	v, e := s.Store.Submission(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Idempotency-Key required", Status: 400})
		return
	}
	var body struct{}
	if r.ContentLength > 0 && !s.decode(w, r, &body, 1024) {
		return
	}
	v, e := s.Store.CancelWithKey(r.Context(), owner(r), r.PathValue("id"), key)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}

func (s *Server) allowedOrigin(origin string) bool {
	for _, o := range s.Origins {
		if origin == o {
			return true
		}
	}
	return s.Local && (origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173" || origin == "http://127.0.0.1:5174")
}
func (s *Server) RequireAdmin(w http.ResponseWriter, r *http.Request) bool {
	p := identity.Subject(r.Context())
	if p.UserID == "" {
		s.err(w, r, &application.Error{Code: "unauthenticated", Message: "Sign in required", Status: 401})
		return false
	}
	if !p.Admin {
		s.err(w, r, &application.Error{Code: "forbidden", Message: "Administrator required", Status: 403})
		return false
	}
	return true
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	p := identity.Subject(r.Context())
	if p.Guest {
		cookie, _ := r.Cookie(guestCookie)
		if cookie != nil {
			ended, err := s.Store.EndGuestSession(r.Context(), cookie.Value)
			if err != nil {
				s.err(w, r, err)
				return
			}
			if ended {
				clearGuestCookie(w)
				s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Guest session ended"})
				return
			}
		}
	}
	role := "user"
	if p.Admin {
		role = "admin"
	}
	mode := "managed"
	if s.Local {
		mode = "development"
	}
	kind := "account"
	if p.Guest {
		kind = "guest"
	}
	caps := access.Capabilities{}
	if !p.Guest && s.Store != nil {
		var err error
		caps, err = s.Store.Capabilities(r.Context(), p.UserID)
		if err != nil {
			s.err(w, r, err)
			return
		}
	}
	respond(w, 200, map[string]any{"capabilities": caps, "strongUntil": p.StrongUntil, "kind": kind, "matchId": p.MatchID, "user": map[string]any{"id": p.UserID, "displayName": p.DisplayName, "emailVerified": p.EmailVerified, "role": role}, "mode": mode})
}

// Empty or malformed credentials never select the development/anonymous fallback.
func requestBearer(r *http.Request) (string, error) {
	if values, present := r.Header["Authorization"]; present {
		if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
			return "", identity.ErrUnauthorized
		}
		token := strings.TrimPrefix(values[0], "Bearer ")
		if token == "" || strings.ContainsAny(token, " \t\r\n") {
			return "", identity.ErrUnauthorized
		}
		return token, nil
	}
	token := ""
	for _, protocol := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		protocol = strings.TrimSpace(protocol)
		if strings.HasPrefix(protocol, "bearer.") {
			candidate := strings.TrimPrefix(protocol, "bearer.")
			if candidate == "" || token != "" {
				return "", identity.ErrUnauthorized
			}
			token = candidate
		}
	}
	return token, nil
}
