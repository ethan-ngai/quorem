package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
)

// A durable pre-admission wake and bounded commit window prevent zero-runner orphan jobs.
func (s *Server) executionAdmission(w http.ResponseWriter, r *http.Request) (context.Context, context.CancelFunc, bool) {
	if s.RequireExecutionWake {
		if s.NotifyExecution == nil {
			s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Judge unavailable"})
			return nil, nil, false
		}
		notify, finish := context.WithTimeout(r.Context(), 2*time.Second)
		err := s.NotifyExecution(notify, application.ID())
		finish()
		if err != nil {
			s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Judge unavailable"})
			return nil, nil, false
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	return ctx, cancel, true
}
