package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

const interviewGuestCookie = "quorem_interview_guest"

type InterviewRepository interface {
	RotateInterviewGuestCredential(context.Context, string, string) (bool, error)
	InterviewPresence(context.Context, string, string) ([]interviews.Presence, error)
	UpdateInterviewPresence(context.Context, string, string, interviews.PresenceInput) ([]interviews.Presence, error)
	Interviews(context.Context, string) ([]interviews.Snapshot, error)
	Interview(context.Context, string, string) (interviews.Snapshot, error)
	CreateInterview(context.Context, string, string, interviews.Create) (interviews.Snapshot, error)
	UpdateInterviewQuestion(context.Context, string, string, string, interviews.QuestionInput) (interviews.Snapshot, error)
	SetInterviewMember(context.Context, string, string, string, string, string) (interviews.Snapshot, error)
	RemoveInterviewMember(context.Context, string, string, string, string) (interviews.Snapshot, error)
	CloseInterview(context.Context, string, string, string) (interviews.Snapshot, error)
	PreviewInterviewInvite(context.Context, string) (interviews.Preview, error)
	JoinInterview(context.Context, string, string, string, string) (interviews.Snapshot, error)
	InterviewGuestIdentity(context.Context, string) (identity.Principal, error)
	InterviewDocument(context.Context, string, string) (interviews.Document, error)
	InterviewUpdates(context.Context, string, string, string, int64) (interviews.Updates, error)
	PushInterviewUpdates(context.Context, string, string, string, interviews.Push) (interviews.Updates, error)
	AdmitInterview(context.Context, string, string, string, string) (judging.Submission, error)
	InterviewSubmission(context.Context, string, string, string) (judging.Submission, error)
}

func interviewPath(path string) bool {
	return path == "/v1/interviews" || strings.HasPrefix(path, "/v1/interviews/") || strings.HasPrefix(path, "/v1/interview-invites/")
}
func (s *Server) interviewStore(w http.ResponseWriter, r *http.Request) (InterviewRepository, bool) {
	repo, ok := s.Store.(InterviewRepository)
	if !ok {
		s.err(w, r, &application.Error{Code: "temporarily_unavailable", Status: 503, Message: "Interviews unavailable"})
	}
	return repo, ok
}
func (s *Server) registerInterviews(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/interviews", s.listInterviews)
	mux.HandleFunc("POST /v1/interviews", s.createInterview)
	mux.HandleFunc("GET /v1/interviews/{id}", s.getInterview)
	mux.HandleFunc("PUT /v1/interviews/{id}/question", s.setInterviewQuestion)
	mux.HandleFunc("POST /v1/interviews/{id}/members", s.setInterviewMember)
	mux.HandleFunc("POST /v1/interviews/{id}/members/{userId}/remove", s.removeInterviewMember)
	mux.HandleFunc("POST /v1/interviews/{id}/close", s.closeInterview)
	mux.HandleFunc("GET /v1/interviews/{id}/presence", s.getInterviewPresence)
	mux.HandleFunc("POST /v1/interviews/{id}/presence", s.setInterviewPresence)
	mux.HandleFunc("GET /v1/interviews/{id}/document", s.getInterviewDocument)
	mux.HandleFunc("GET /v1/interviews/{id}/updates", s.getInterviewUpdates)
	mux.HandleFunc("POST /v1/interviews/{id}/updates", s.pushInterviewUpdates)
	mux.HandleFunc("POST /v1/interviews/{id}/submissions", s.admitInterview)
	mux.HandleFunc("GET /v1/interviews/{id}/submissions/{submissionId}", s.getInterviewSubmission)
	mux.HandleFunc("GET /v1/interview-invites/{token}", s.previewInterview)
	mux.HandleFunc("POST /v1/interview-invites/{token}/join", s.joinInterview)
}
func (s *Server) interviewRequest(w http.ResponseWriter, r *http.Request) (InterviewRepository, bool) {
	repo, ok := s.interviewStore(w, r)
	if !ok {
		return nil, false
	}
	if owner(r) == "" {
		s.err(w, r, &application.Error{Code: "unauthenticated", Status: 401, Message: "Sign in or join this interview"})
		return nil, false
	}
	if id := r.PathValue("id"); id != "" && !uuid.MatchString(id) {
		s.err(w, r, &application.Error{Code: "not_found", Status: 404, Message: "Interview unavailable"})
		return nil, false
	}
	return repo, true
}
func (s *Server) listInterviews(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	v, e := repo.Interviews(r.Context(), owner(r))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) createInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var c interviews.Create
	if !s.decode(w, r, &c, 256*1024) {
		return
	}
	v, e := repo.CreateInterview(r.Context(), owner(r), key, c)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 201, v)
}
func (s *Server) getInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	v, e := repo.Interview(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) setInterviewQuestion(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var q interviews.QuestionInput
	if !s.decode(w, r, &q, 256*1024) {
		return
	}
	v, e := repo.UpdateInterviewQuestion(r.Context(), owner(r), r.PathValue("id"), key, q)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) setInterviewMember(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var c struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if !s.decode(w, r, &c, 1024) {
		return
	}
	v, e := repo.SetInterviewMember(r.Context(), owner(r), r.PathValue("id"), key, c.UserID, c.Role)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) removeInterviewMember(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	v, e := repo.RemoveInterviewMember(r.Context(), owner(r), r.PathValue("id"), key, r.PathValue("userId"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) closeInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	v, e := repo.CloseInterview(r.Context(), owner(r), r.PathValue("id"), key)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) getInterviewDocument(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	v, e := repo.InterviewDocument(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) getInterviewUpdates(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	version, e := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
	if e != nil {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Document version required"})
		return
	}
	v, e := repo.InterviewUpdates(r.Context(), owner(r), r.PathValue("id"), r.URL.Query().Get("epoch"), version)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) pushInterviewUpdates(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var p interviews.Push
	if !s.decode(w, r, &p, 256*1024) {
		return
	}
	v, e := repo.PushInterviewUpdates(r.Context(), owner(r), r.PathValue("id"), key, p)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) previewInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewStore(w, r)
	if !ok {
		return
	}
	v, e := repo.PreviewInterviewInvite(r.Context(), r.PathValue("token"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	respond(w, 200, v)
}
func (s *Server) joinInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewStore(w, r)
	if !ok {
		return
	}
	if !s.guestOrigin(w, r) {
		return
	}
	var c struct {
		Name string `json:"name"`
	}
	if !s.decode(w, r, &c, 512) {
		return
	}
	user := owner(r)
	guest := user == "" || identity.Subject(r.Context()).Guest
	credential := ""
	if guest {
		user = ""
		if cookie, e := r.Cookie(interviewGuestCookie); e == nil {
			credential = cookie.Value
		}
		rotate := !validInterviewCredential(credential)
		if !rotate {
			var e error
			rotate, e = repo.RotateInterviewGuestCredential(r.Context(), credential, r.PathValue("token"))
			if e != nil {
				s.err(w, r, e)
				return
			}
		}
		if c.Name == "" {
			c.Name = identity.Subject(r.Context()).DisplayName
		}
		if rotate {
			raw := make([]byte, 32)
			if _, e := rand.Read(raw); e != nil {
				s.err(w, r, e)
				return
			}
			credential = base64.RawURLEncoding.EncodeToString(raw)
		}
	}
	v, e := repo.JoinInterview(r.Context(), user, r.PathValue("token"), credential, c.Name)
	if e != nil {
		s.err(w, r, e)
		return
	}
	if guest {
		origin, _ := url.Parse(r.Header.Get("Origin"))
		secure := origin.Scheme == "https"
		http.SetCookie(w, &http.Cookie{Name: interviewGuestCookie, Value: credential, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: 86400})
	}
	respond(w, 200, v)
}
func validInterviewCredential(v string) bool {
	raw, e := base64.RawURLEncoding.DecodeString(v)
	return e == nil && len(raw) == 32
}
func (s *Server) admitInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var c struct {
		Kind string `json:"kind"`
	}
	if !s.decode(w, r, &c, 1024) {
		return
	}
	v, e := repo.AdmitInterview(r.Context(), owner(r), r.PathValue("id"), key, c.Kind)
	if e != nil {
		s.err(w, r, e)
		return
	}
	if s.NotifyExecution != nil && v.ExecutionJobID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		if err := s.NotifyExecution(ctx, v.ExecutionJobID); err != nil {
			log.Print("Interview execution notification unavailable; database polling will recover")
		}
		cancel()
	}
	respond(w, 202, v)
}
func (s *Server) getInterviewSubmission(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	v, e := repo.InterviewSubmission(r.Context(), owner(r), r.PathValue("id"), r.PathValue("submissionId"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}

func (s *Server) getInterviewPresence(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	v, e := repo.InterviewPresence(r.Context(), owner(r), r.PathValue("id"))
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) setInterviewPresence(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	var p interviews.PresenceInput
	if !s.decode(w, r, &p, 1024) {
		return
	}
	v, e := repo.UpdateInterviewPresence(r.Context(), owner(r), r.PathValue("id"), p)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
