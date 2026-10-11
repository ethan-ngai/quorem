package httpapi

import (
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"io"
	"math"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Server struct {
	Store    *postgres.Store
	Events   realtime.PubSub
	Presence realtime.Presence
	Local    bool
}

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var decimal = regexp.MustCompile(`^[0-9]{1,30}$`)

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /v1/problems", s.listProblems)
	mux.HandleFunc("GET /v1/problems/{slug}", s.problem)
	mux.HandleFunc("GET /v1/problem-versions/{id}", s.problem)
	mux.HandleFunc("POST /v1/workspaces", s.createWorkspace)
	mux.HandleFunc("GET /v1/workspaces/{id}", s.getWorkspace)
	mux.HandleFunc("GET /v1/workspaces/{id}/draft", s.getDraft)
	mux.HandleFunc("PUT /v1/workspaces/{id}/draft", s.save)
	mux.HandleFunc("GET /v1/workspaces/{id}/draft-history", s.history)
	mux.HandleFunc("POST /v1/workspaces/{id}/restore", s.restore)
	mux.HandleFunc("POST /v1/submissions", s.admit)
	mux.HandleFunc("GET /v1/submissions/{id}", s.submission)
	mux.HandleFunc("POST /v1/submissions/{id}/cancel", s.cancel)
	mux.HandleFunc("POST /v1/matches", s.createMatch)
	mux.HandleFunc("POST /v1/matches/join", s.joinMatch)
	mux.HandleFunc("GET /v1/matches/{id}", s.getMatch)
	for _, action := range []string{"ready", "forfeit", "leave"} {
		a := action
		mux.HandleFunc("POST /v1/matches/{id}/"+a, func(w http.ResponseWriter, r *http.Request) { r.SetPathValue("action", a); s.mutateMatch(w, r) })
	}
	mux.HandleFunc("PUT /v1/matches/{id}/settings", func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("action", "settings")
		s.mutateMatch(w, r)
	})
	s.registerRealtime(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := postgres.ID()
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			u := strings.TrimSuffix(origin, "/")
			if u != "http://localhost:5173" && u != "http://127.0.0.1:5173" {
				s.err(w, r, &postgres.Error{Code: "forbidden", Message: "Origin denied", Status: 403})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", u)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Dev-User")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if !s.Local || err != nil || !net.ParseIP(host).IsLoopback() {
			s.err(w, r, &postgres.Error{Code: "unauthenticated", Message: "Local development identity unavailable", Status: 401})
			return
		}
		owner := r.Header.Get("X-Dev-User")
		if owner == "" {
			owner = "alice"
		}
		if owner != "alice" && owner != "bob" {
			s.err(w, r, &postgres.Error{Code: "unauthenticated", Message: "Unknown development identity", Status: 401})
			return
		}
		r.Header.Set("X-Quorem-Owner", owner)
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
	var typed *postgres.Error
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
		s.err(w, r, &postgres.Error{Code: code, Message: "Invalid request body", Status: status})
		return false
	}
	return true
}
func (s *Server) listProblems(w http.ResponseWriter, r *http.Request) {
	v, e := s.Store.Problems(r.Context())
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, map[string]any{"items": v})
}
func (s *Server) problem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	value := r.PathValue("slug")
	if id != "" {
		value = id
	}
	v, e := s.Store.Problem(r.Context(), value, id != "")
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
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid problem ID", Status: 400})
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
func (s *Server) getDraft(w http.ResponseWriter, r *http.Request) {
	v, e := s.Store.Workspace(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v.Draft)
}
func validSource(source string) bool { return utf8.ValidString(source) && len(source) <= 65536 }
func (s *Server) save(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source          string `json:"source"`
		EditorSessionID string `json:"editorSessionId"`
		SaveSequence    string `json:"saveSequence"`
	}
	if !s.decode(w, r, &body, 400000) {
		return
	}
	if !validSource(body.Source) || !uuid.MatchString(body.EditorSessionID) || !decimal.MatchString(body.SaveSequence) {
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid source or save sequence", Status: 400})
		return
	}
	v, e := s.Store.Save(r.Context(), owner(r), r.PathValue("id"), body.Source, body.EditorSessionID, body.SaveSequence, nil)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, map[string]any{"revision": v.Revision, "savedAt": v.SavedAt})
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	cursor := int64(math.MaxInt64)
	limit := 20
	var err error
	if q := r.URL.Query().Get("cursor"); q != "" {
		cursor, err = strconv.ParseInt(q, 10, 64)
	}
	if q := r.URL.Query().Get("limit"); q != "" && err == nil {
		limit, err = strconv.Atoi(q)
	}
	if err != nil || cursor < 0 || limit < 1 || limit > 100 {
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid pagination", Status: 400})
		return
	}
	v, e := s.Store.History(r.Context(), owner(r), r.PathValue("id"), cursor, limit)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Revision string `json:"revision"`
	}
	if !s.decode(w, r, &body, 4096) {
		return
	}
	rev, e := strconv.ParseInt(body.Revision, 10, 64)
	if e != nil || rev < 1 {
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid revision", Status: 400})
		return
	}
	v, e := s.Store.Save(r.Context(), owner(r), r.PathValue("id"), "", "", "", &rev)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, map[string]any{"revision": v.Revision, "savedAt": v.SavedAt})
}
func (s *Server) admit(w http.ResponseWriter, r *http.Request) {
	var body judging.Command
	if !s.decode(w, r, &body, 600000) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	custom, _ := json.Marshal(body.CustomCases)
	if key == "" || len(key) > 128 || !uuid.MatchString(body.WorkspaceID) || !validSource(body.Source) || (body.Kind != "run" && body.Kind != "submit") || len(custom) > 65536 || len(body.CustomCases) > 20 || (body.CustomCases != nil && len(body.CustomCases) == 0) {
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid execution command", Status: 400})
		return
	}
	canonical, _ := json.Marshal(body)
	v, e := s.Store.Admit(r.Context(), owner(r), key, body, postgres.Hash(canonical))
	if e != nil {
		s.err(w, r, e)
		return
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
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Idempotency-Key required", Status: 400})
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
