package httpapi

import (
	"net/http"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func (s *Server) registerAdminQuestions(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/admin/question-drafts", s.listQuestionDrafts)
	mux.HandleFunc("POST /v1/admin/question-drafts", s.createQuestionDraft)
	mux.HandleFunc("GET /v1/admin/question-drafts/{id}", s.getQuestionDraft)
	mux.HandleFunc("PUT /v1/admin/question-drafts/{id}", s.updateQuestionDraft)
	mux.HandleFunc("POST /v1/admin/question-drafts/{id}/publish", s.publishQuestionDraft)
}
func (s *Server) adminDraftRequest(w http.ResponseWriter, r *http.Request) bool {
	if !s.RequireAdmin(w, r) {
		return false
	}
	if id := r.PathValue("id"); id != "" && !uuid.MatchString(id) {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Invalid draft ID", Status: 400})
		return false
	}
	return true
}
func (s *Server) listQuestionDrafts(w http.ResponseWriter, r *http.Request) {
	if !s.adminDraftRequest(w, r) {
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if cursor != "" && !uuid.MatchString(cursor) {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Invalid cursor", Status: 400})
		return
	}
	page, err := s.Store.QuestionDrafts(r.Context(), cursor)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, page)
}
func (s *Server) createQuestionDraft(w http.ResponseWriter, r *http.Request) {
	if !s.adminDraftRequest(w, r) {
		return
	}
	var request struct {
		Content          *problems.QuestionContent `json:"content"`
		ProblemVersionID string                    `json:"problemVersionId"`
	}
	if !s.decode(w, r, &request, problems.AuthoringBodyLimit+1024) {
		return
	}
	if (request.Content == nil) == (request.ProblemVersionID == "") {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Provide content or problemVersionId", Status: 400})
		return
	}
	var content problems.QuestionContent
	if request.Content != nil {
		content = *request.Content
	} else {
		if !uuid.MatchString(request.ProblemVersionID) {
			s.err(w, r, &application.Error{Code: "invalid_input", Message: "Invalid problem version", Status: 400})
			return
		}
		var err error
		content, err = s.Store.QuestionContent(r.Context(), request.ProblemVersionID)
		if err != nil {
			s.err(w, r, err)
			return
		}
	}
	draft, err := s.Store.CreateQuestionDraft(r.Context(), identity.Subject(r.Context()).UserID, content)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 201, draft)
}
func (s *Server) getQuestionDraft(w http.ResponseWriter, r *http.Request) {
	if !s.adminDraftRequest(w, r) {
		return
	}
	draft, err := s.Store.QuestionDraft(r.Context(), r.PathValue("id"))
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, draft)
}
func (s *Server) updateQuestionDraft(w http.ResponseWriter, r *http.Request) {
	if !s.adminDraftRequest(w, r) {
		return
	}
	var request struct {
		Revision string                    `json:"revision"`
		Content  *problems.QuestionContent `json:"content"`
	}
	if !s.decode(w, r, &request, problems.AuthoringBodyLimit+1024) {
		return
	}
	if request.Content == nil {
		s.err(w, r, &application.Error{Code: "invalid_input", Message: "Content required", Status: 400})
		return
	}
	draft, err := s.Store.UpdateQuestionDraft(r.Context(), identity.Subject(r.Context()).UserID, r.PathValue("id"), request.Revision, *request.Content)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, draft)
}
func (s *Server) publishQuestionDraft(w http.ResponseWriter, r *http.Request) {
	if identity.Subject(r.Context()).Admin && !s.Local && identity.Subject(r.Context()).StrongUntil <= time.Now().Unix() {
		s.err(w, r, &application.Error{Code: "step_up_required", Status: 403, Message: "Sign in with a verified passkey again before publishing"})
		return
	}
	if !s.adminDraftRequest(w, r) {
		return
	}
	var request struct {
		Revision string `json:"revision"`
	}
	if !s.decode(w, r, &request, 1024) {
		return
	}
	draft, err := s.Store.PublishQuestionDraft(r.Context(), identity.Subject(r.Context()).UserID, r.PathValue("id"), request.Revision)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, draft)
}
