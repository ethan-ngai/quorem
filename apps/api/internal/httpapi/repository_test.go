package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"log"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type catalogRepository struct {
	Repository
	filter problems.ProblemFilter
	err    error
}

func (r *catalogRepository) ProblemCatalog(_ context.Context, filter problems.ProblemFilter) (problems.ProblemPage, error) {
	r.filter = filter
	return problems.ProblemPage{Items: []problems.Problem{}, Total: 7, Page: filter.Page, Limit: filter.Limit, Topics: []string{"strings"}}, r.err
}

func TestCatalogConsumesApplicationRepository(t *testing.T) {
	repository := &catalogRepository{}
	server := (&Server{Store: repository}).Handler()
	request := httptest.NewRequest("GET", "/v1/problems?topic=strings&difficulty=medium", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	var page problems.ProblemPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || page.Total != 7 || repository.filter.Topic != "strings" || repository.filter.Difficulty != "medium" {
		t.Fatalf("response %d %s, filter %+v", response.Code, response.Body.String(), repository.filter)
	}
}

func TestRepositoryErrorsExposeOnlyApprovedApplicationMessages(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"application error", &application.Error{Code: "invalid_input", Status: 400, Message: "Invalid question pagination"}, 400, "Invalid question pagination"},
		{"provider error", errors.New("provider connection secret"), 503, "Service unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := (&Server{Store: &catalogRepository{err: tc.err}}).Handler()
			response := httptest.NewRecorder()
			server.ServeHTTP(response, httptest.NewRequest("GET", "/v1/problems", nil))
			var body struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || body.Error.Message != tc.message {
				t.Fatalf("response %d %s", response.Code, response.Body.String())
			}
		})
	}
}

type admissionRepository struct {
	Repository
	result    judging.Submission
	err       error
	calls     int
	committed bool
	command   judging.Command
}

func (r *admissionRepository) Admit(_ context.Context, _, _ string, command judging.Command, _ string) (judging.Submission, error) {
	r.calls++
	r.command = command
	r.committed = r.err == nil
	return r.result, r.err
}

func TestExecutionNotificationFollowsSuccessfulAdmission(t *testing.T) {
	const source = "private source must stay out of notifications"
	const jobID = "23fe2164-6df7-425c-bdf7-d69b8bd1362e"
	for _, tc := range []struct {
		name                              string
		jobID                             string
		repositoryError                   error
		notificationError                 error
		invalidCommand                    bool
		status, admissions, notifications int
	}{
		{name: "committed job", jobID: jobID, status: 202, admissions: 1, notifications: 1},
		{name: "notification failure retains committed admission", jobID: jobID, notificationError: errors.New("secret provider endpoint or credentials"), status: 202, admissions: 1, notifications: 1},
		{name: "idempotent replay has no new job", status: 202, admissions: 1},
		{name: "rejected admission does not notify", jobID: jobID, repositoryError: &application.Error{Code: "rate_limited", Message: "Try again later", Status: 429}, status: 429, admissions: 1},
		{name: "invalid command never reaches admission", jobID: jobID, invalidCommand: true, status: 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &admissionRepository{result: judging.Submission{ID: "submission", State: "queued", ExecutionJobID: tc.jobID, SourceHash: "digest"}, err: tc.repositoryError}
			notifications := []string{}
			var logs bytes.Buffer
			originalWriter := log.Writer()
			log.SetOutput(&logs)
			defer log.SetOutput(originalWriter)
			server := &Server{Store: repository, NotifyExecution: func(ctx context.Context, id string) error {
				if !repository.committed {
					t.Fatal("notified before repository committed admission")
				}
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) <= 0 || time.Until(deadline) > 2*time.Second {
					t.Fatalf("unbounded notification context: %v %v", deadline, ok)
				}
				if id != jobID || strings.Contains(id, source) {
					t.Fatalf("notification must contain only job ID: %q", id)
				}
				notifications = append(notifications, id)
				return tc.notificationError
			}}
			command := judging.Command{WorkspaceID: "bdccf853-633e-455f-906d-d585cb44fdd1", Kind: "submit", Source: source}
			if tc.invalidCommand {
				command.Kind = "unsupported"
			}
			body, err := json.Marshal(command)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/v1/submissions", bytes.NewReader(body))
			request.Header.Set("Idempotency-Key", "same-command")
			request.Header.Set("X-Quorem-Owner", "alice")
			response := httptest.NewRecorder()
			server.admit(response, request)
			if response.Code != tc.status || repository.calls != tc.admissions || len(notifications) != tc.notifications {
				t.Fatalf("status=%d admissions=%d notifications=%v body=%s", response.Code, repository.calls, notifications, response.Body.String())
			}
			if strings.Contains(response.Body.String(), source) || strings.Contains(response.Body.String(), jobID) {
				t.Fatalf("private source or internal job leaked: %s", response.Body.String())
			}
			if strings.Contains(logs.String(), "secret provider") || strings.Contains(logs.String(), source) {
				t.Fatalf("raw provider error or source logged: %s", logs.String())
			}
			if tc.notificationError != nil && !strings.Contains(logs.String(), "database polling will recover") {
				t.Fatalf("missing recovery log: %s", logs.String())
			}
		})
	}
}

func TestSubmissionJobIDIsInternal(t *testing.T) {
	data, err := json.Marshal(judging.Submission{ID: "public-submission", ExecutionJobID: "internal-job"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "internal-job") || strings.Contains(string(data), "ExecutionJobID") {
		t.Fatalf("internal job ID leaked: %s", data)
	}
}
