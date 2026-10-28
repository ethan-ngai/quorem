package httpapi

import (
	"context"
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
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

const interviewGuestCookie = "quorem_interview_guest"

type InterviewRepository interface {
	PassInterviewStage(context.Context, string, string, string, string, int) (interviews.Snapshot, error)
	SetInterviewAdmission(context.Context, string, string, string, bool) (interviews.Snapshot, error)
	SetInterviewMonitoring(context.Context, string, string, string, interviews.Monitoring) (interviews.Snapshot, error)
	ReportInterviewRule(context.Context, string, string, string, string) error
	SetInterviewHints(context.Context, string, string, string, problems.HintVisibility) (interviews.Snapshot, error)
	SwitchInterviewLanguage(context.Context, string, string, string, string, string) (interviews.Snapshot, error)
	SetInterviewCaseVisibility(context.Context, string, string, string, string, bool, ...string) (interviews.Snapshot, error)
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
	DeleteInterview(context.Context, string, string) error
	PreviewInterviewInvite(context.Context, string) (interviews.Preview, error)
	JoinInterview(context.Context, string, string, string, string) (interviews.Snapshot, error)
	InterviewGuestIdentity(context.Context, string) (identity.Principal, error)
	InterviewDocument(context.Context, string, string) (interviews.Document, error)
	InterviewUpdates(context.Context, string, string, string, int64) (interviews.Updates, error)
	PushInterviewUpdates(context.Context, string, string, string, interviews.Push) (interviews.Updates, error)
	AdmitInterview(context.Context, string, string, string, interviews.ExecutionCommand) (judging.Submission, error)
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
	mux.HandleFunc("GET /v1/interviews/{id}/events", s.interviewEvents)
	mux.HandleFunc("DELETE /v1/interviews/{id}", s.deleteInterview)
	mux.HandleFunc("PUT /v1/interviews/{id}/question", s.setInterviewQuestion)
	mux.HandleFunc("POST /v1/interviews/{id}/hints", s.setInterviewHints)
	mux.HandleFunc("POST /v1/interviews/{id}/monitoring", s.setInterviewMonitoring)
	mux.HandleFunc("POST /v1/interviews/{id}/admission", s.setInterviewAdmission)
	mux.HandleFunc("POST /v1/interviews/{id}/rule-events", s.reportInterviewRule)
	mux.HandleFunc("POST /v1/interviews/{id}/language", s.switchInterviewLanguage)
	mux.HandleFunc("POST /v1/interviews/{id}/pass-stage", s.passInterviewStage)
	mux.HandleFunc("POST /v1/interviews/{id}/cases/{caseId}/visibility", s.setInterviewCaseVisibility)
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
	if !s.decode(w, r, &c, execution.MaxCustomCasesBytes+1024) {
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
		rotate := !identity.ValidGuestToken(credential)
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
			var e error
			credential, e = identity.NewGuestToken()
			if e != nil {
				s.err(w, r, e)
				return
			}
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
		setGuestCookie(w, interviewGuestCookie, credential, secure)
	}
	respond(w, 200, v)
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
	var c interviews.ExecutionCommand
	if !s.decode(w, r, &c, execution.MaxCustomCasesBytes+512*1024) {
		return
	}
	if (c.Kind != "run" && c.Kind != "submit") || !validExecutionCases(c.Kind, c.CustomCases) || c.Level < 1 || !uuid.MatchString(c.QuestionEpoch) || !uuid.MatchString(c.DocumentEpoch) || !sourceHash.MatchString(c.SourceHash) {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Invalid execution command"})
		return
	}
	ctx, cancel, ok := s.executionAdmission(w, r)
	if !ok {
		return
	}
	defer cancel()
	v, e := repo.AdmitInterview(ctx, owner(r), r.PathValue("id"), key, c)
	if e != nil {
		s.err(w, r, e)
		return
	}
	if !s.RequireExecutionWake && s.NotifyExecution != nil && v.ExecutionJobID != "" {
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

func (s *Server) switchInterviewLanguage(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var c struct {
		Language string `json:"language"`
		Epoch    string `json:"epoch"`
	}
	if !s.decode(w, r, &c, 1024) {
		return
	}
	v, e := repo.SwitchInterviewLanguage(r.Context(), owner(r), r.PathValue("id"), key, c.Language, c.Epoch)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}
func (s *Server) setInterviewCaseVisibility(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var c struct {
		Revealed      *bool  `json:"revealed"`
		QuestionEpoch string `json:"questionEpoch"`
	}
	if !s.decode(w, r, &c, 128) {
		return
	}
	if c.Revealed == nil || c.QuestionEpoch == "" {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Test visibility required"})
		return
	}
	v, e := repo.SetInterviewCaseVisibility(r.Context(), owner(r), r.PathValue("id"), key, r.PathValue("caseId"), *c.Revealed, c.QuestionEpoch)
	if e != nil {
		s.err(w, r, e)
		return
	}
	respond(w, 200, v)
}

func (s *Server) deleteInterview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	if err := repo.DeleteInterview(r.Context(), owner(r), r.PathValue("id")); err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, map[string]bool{"deleted": true})
}

func (s *Server) setInterviewHints(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var hints problems.HintVisibility
	if !s.decode(w, r, &hints, 1024) {
		return
	}
	v, err := repo.SetInterviewHints(r.Context(), owner(r), r.PathValue("id"), key, hints)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}

func (s *Server) setInterviewMonitoring(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var policy interviews.Monitoring
	if !s.decode(w, r, &policy, 1024) {
		return
	}
	v, err := repo.SetInterviewMonitoring(r.Context(), owner(r), r.PathValue("id"), key, policy)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}
func (s *Server) reportInterviewRule(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var event struct {
		Kind string `json:"kind"`
	}
	if !s.decode(w, r, &event, 1024) {
		return
	}
	if err := repo.ReportInterviewRule(r.Context(), owner(r), r.PathValue("id"), key, event.Kind); err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, struct{}{})
}

func (s *Server) setInterviewAdmission(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var body struct {
		Locked *bool `json:"locked"`
	}
	if !s.decode(w, r, &body, 1024) {
		return
	}
	if body.Locked == nil {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Specify room lock state"})
		return
	}
	v, err := repo.SetInterviewAdmission(r.Context(), owner(r), r.PathValue("id"), key, *body.Locked)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}

func (s *Server) passInterviewStage(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.interviewRequest(w, r)
	if !ok {
		return
	}
	key := s.matchKey(w, r)
	if key == "" {
		return
	}
	var body struct {
		QuestionEpoch string `json:"questionEpoch"`
		Level         int    `json:"level"`
	}
	if !s.decode(w, r, &body, 1024) {
		return
	}
	if body.QuestionEpoch == "" || body.Level < 1 {
		s.err(w, r, &application.Error{Code: "invalid_input", Status: 400, Message: "Question and stage required"})
		return
	}
	v, err := repo.PassInterviewStage(r.Context(), owner(r), r.PathValue("id"), key, body.QuestionEpoch, body.Level)
	if err != nil {
		s.err(w, r, err)
		return
	}
	respond(w, 200, v)
}
