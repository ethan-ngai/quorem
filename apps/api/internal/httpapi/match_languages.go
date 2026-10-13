package httpapi

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"net/http"
)

func (s *Server) registerMatchLanguages(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/matches/{id}/workspace-language", func(w http.ResponseWriter, r *http.Request) {
		key := s.matchKey(w, r)
		if key == "" {
			return
		}
		var body struct {
			Language string `json:"language"`
		}
		if !s.decode(w, r, &body, 4096) {
			return
		}
		if !uuid.MatchString(r.PathValue("id")) {
			s.err(w, r, &postgres.Error{Code: "invalid_input", Status: 400, Message: "Invalid match ID"})
			return
		}
		value, err := s.Store.SwitchMatchLanguage(r.Context(), owner(r), r.PathValue("id"), key, body.Language)
		if err != nil {
			s.err(w, r, err)
			return
		}
		respond(w, 200, value)
	})
}
