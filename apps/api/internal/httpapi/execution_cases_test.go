package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestExecutionCaseBounds(t *testing.T) {
	valid := []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}}}
	large, _ := json.Marshal(strings.Repeat("a", execution.MaxCustomCasesBytes))
	for _, test := range []struct {
		kind  string
		cases []problems.Case
		valid bool
	}{
		{"run", nil, true}, {"submit", nil, true}, {"run", valid, true},
		{"submit", valid, false}, {"run", []problems.Case{}, false},
		{"run", make([]problems.Case, 21), false},
		{"run", []problems.Case{{Args: []json.RawMessage{large}}}, false},
	} {
		if got := validExecutionCases(test.kind, test.cases); got != test.valid {
			t.Fatalf("kind=%s cases=%d: %v", test.kind, len(test.cases), got)
		}
	}
}

func TestInterviewAdmissionAcceptsBoundedLargeCustomCases(t *testing.T) {
	repo := &wakeInterviewRepository{interviewRepositoryFake: &interviewRepositoryFake{}}
	api := &Server{Store: repo}
	body, err := json.Marshal(map[string]any{"kind": "run", "questionEpoch": "00000000-0000-4000-8000-000000000001", "documentEpoch": "00000000-0000-4000-8000-000000000002", "sourceHash": strings.Repeat("a", 64), "customCases": []any{map[string]any{"args": []string{strings.Repeat("a", 4096)}}}})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/v1/interviews/room/submissions", bytes.NewReader(body))
	request.Header.Set("Idempotency-Key", "retry-command")
	request.Header.Set("X-Quorem-Owner", "alice")
	response := httptest.NewRecorder()
	api.admitInterview(response, request)
	if response.Code != 202 || repo.calls != 1 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, repo.calls, response.Body.String())
	}
}

func TestInterviewAdmissionRequiresDocumentFence(t *testing.T) {
	for _, body := range []string{
		`{"kind":"run"}`,
		`{"kind":"run","questionEpoch":"00000000-0000-4000-8000-000000000001","documentEpoch":"00000000-0000-4000-8000-000000000002","sourceHash":"invalid"}`,
	} {
		repo := &wakeInterviewRepository{interviewRepositoryFake: &interviewRepositoryFake{}}
		api := &Server{Store: repo}
		request := httptest.NewRequest("POST", "/v1/interviews/room/submissions", strings.NewReader(body))
		request.Header.Set("Idempotency-Key", "retry-command")
		request.Header.Set("X-Quorem-Owner", "alice")
		response := httptest.NewRecorder()
		api.admitInterview(response, request)
		if response.Code != 400 || repo.calls != 0 {
			t.Fatalf("status=%d calls=%d", response.Code, repo.calls)
		}
	}
}
