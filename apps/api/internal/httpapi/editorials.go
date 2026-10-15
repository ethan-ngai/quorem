package httpapi

import (
	"net/http"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
)

func (s *Server) registerEditorials(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/problem-versions/{id}/solutions", s.editorials)
	mux.HandleFunc("GET /v1/problem-versions/{id}/complexity", s.complexity)
}

func (s *Server) allowEditorial(w http.ResponseWriter, r *http.Request) bool {
	if !uuid.MatchString(r.PathValue("id")) {
		s.err(w, r, &postgres.Error{Code: "invalid_input", Message: "Invalid problem ID", Status: 400})
		return false
	}
	// Practice routes cannot bypass a participant's active-match spoiler gate.
	var active bool
	err := s.Store.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id WHERE p.owner_id=$1 AND m.problem_version_id::text=$2 AND m.state IN ('active','finalizing'))`, owner(r), r.PathValue("id")).Scan(&active)
	if err != nil {
		s.err(w, r, err)
		return false
	}
	if active {
		s.err(w, r, &postgres.Error{Code: "forbidden", Message: "Editorial unavailable during an active match", Status: 403})
		return false
	}
	return true
}

func (s *Server) editorials(w http.ResponseWriter, r *http.Request) {
	if !s.allowEditorial(w, r) {
		return
	}
	items, err := s.Store.Solutions(r.Context(), r.PathValue("id"))
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (s *Server) complexity(w http.ResponseWriter, r *http.Request) {
	if !s.allowEditorial(w, r) {
		return
	}
	items, err := s.Store.Solutions(r.Context(), r.PathValue("id"))
	if err != nil {
		s.err(w, r, err)
		return
	}
	costs := make([]map[string]string, 0, len(items))
	for _, item := range items {
		costs = append(costs, map[string]string{"language": item.Language, "timeComplexity": item.TimeComplexity, "spaceComplexity": item.SpaceComplexity, "complexityNotes": item.ComplexityNotes})
	}
	respond(w, 200, map[string]any{"items": costs})
}
