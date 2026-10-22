package httpapi

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"net/http"
)

func (s *Server) matchKey(w http.ResponseWriter, r *http.Request) string {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Idempotency-Key required"})
		return ""
	}
	return key
}
func (s *Server) createMatch(w http.ResponseWriter, r *http.Request) {
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var body matches.Settings
	if !s.decode(w, r, &body, 4096) {
		return
	}
	v, e := s.Store.CreateMatch(r.Context(), owner(r), key, body)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 201, v)
}
func (s *Server) joinMatch(w http.ResponseWriter, r *http.Request) {
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var body struct {
		InviteToken string `json:"inviteToken"`
	}
	if !s.decode(w, r, &body, 4096) {
		return
	}
	v, e := s.Store.JoinMatch(r.Context(), owner(r), key, body.InviteToken)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, s.withPresence(v))
}
func (s *Server) getMatch(w http.ResponseWriter, r *http.Request) {
	v, e := s.Store.Match(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, s.withPresence(v))
}
func (s *Server) mutateMatch(w http.ResponseWriter, r *http.Request) {
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	id := r.PathValue("id")
	var v matches.Snapshot
	var e error
	switch r.PathValue("action") {
	case "start":
		v, e = s.Store.StartMatch(r.Context(), owner(r), id, key)
	case "rule-events":
		var body struct {
			Kind string `json:"kind"`
		}
		if !s.decode(w, r, &body, 1024) {
			return
		}
		v, e = s.Store.ReportMatchRule(r.Context(), owner(r), id, key, body.Kind)
	case "ready":
		var body struct {
			Ready *bool `json:"ready"`
		}
		if !s.decode(w, r, &body, 1024) {
			return
		}
		if body.Ready == nil {
			s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Ready is required"})
			return
		}
		v, e = s.Store.ReadyMatch(r.Context(), owner(r), id, key, *body.Ready)
	case "settings":
		var body matches.Settings
		if !s.decode(w, r, &body, 4096) {
			return
		}
		v, e = s.Store.UpdateMatchSettings(r.Context(), owner(r), id, key, body)
	case "forfeit", "leave":
		var body struct{}
		if r.ContentLength > 0 && !s.decode(w, r, &body, 1024) {
			return
		}
		if r.PathValue("action") == "forfeit" {
			v, e = s.Store.ForfeitMatch(r.Context(), owner(r), id, key)
		} else {
			v, e = s.Store.LeaveMatch(r.Context(), owner(r), id, key)
		}
	default:
		s.err(w, r, &application.Error{Code: "not_found", Status: 404, Message: "Route not found"})
		return
	}
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, s.withPresence(v))
}
