package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"net/http"
)

type odysseyRepository interface {
	Odyssey(context.Context, string, string) (problems.OdysseyProgress, error)
}

func (s *Server) registerOdyssey(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/workspaces/{id}/odyssey", func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.Store.(odysseyRepository)
		if !ok {
			s.err(w, r, &application.Error{Code: "unavailable", Status: 503, Message: "Odyssey unavailable"})
			return
		}
		if !uuid.MatchString(r.PathValue("id")) {
			s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Invalid workspace"})
			return
		}
		result, err := repo.Odyssey(r.Context(), owner(r), r.PathValue("id"))
		if err != nil {
			s.err(w, r, err)
			return
		}
		respond(w, 200, result)
	})
}
