package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/httpapi"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestHTTPCreatePrivateStagedInterviewWithoutPublication(t *testing.T) {
	s := guestLifecycleStore(t)
	ctx := context.Background()
	method := problems.Signature{ClassName: "Solution", MethodName: "answer", Parameters: []problems.Parameter{}, ReturnType: "int"}
	testCase := problems.Case{Args: []json.RawMessage{}, Calls: []problems.MethodCall{{MethodName: "answer", Args: []json.RawMessage{}, Expected: json.RawMessage(`1`)}}}
	starter, err := problems.GenerateStarter([]problems.Signature{method}, "python", true)
	if err != nil {
		t.Fatal(err)
	}
	input := interviews.Create{Title: "Private staged pad", Question: interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Answer", StatementMarkdown: "Return one.", Signature: method, Odyssey: &problems.Odyssey{Levels: []problems.OdysseyLevel{{Title: "Answer", StatementMarkdown: "Implement answer.", Methods: []problems.Signature{method}, Examples: []problems.ProblemExample{{Case: testCase}}}}}, OdysseyHiddenCases: [][]problems.Case{{testCase}}}}}
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/v1/interviews", strings.NewReader(string(body)))
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("Origin", "https://quorem.test")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", postgres.ID())
	w := httptest.NewRecorder()
	(&httpapi.Server{Store: s, Local: true, Origins: []string{"https://quorem.test"}}).Handler().ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	var snapshot interviews.Snapshot
	if err = json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Question.Progress == nil || snapshot.Question.Progress.TotalLevels != 1 || snapshot.Document.Source != starter || !strings.Contains(snapshot.Document.Source, "def answer") || len(snapshot.Question.PrivateCaseDetails) != 1 {
		t.Fatal("private staged HTTP response", snapshot)
	}
	var publications int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE p.owner_id IS NULL`).Scan(&publications); err != nil || publications != 0 {
		t.Fatal("private pad published problem", publications, err)
	}
	passBody, _ := json.Marshal(map[string]any{"questionEpoch": snapshot.QuestionEpoch, "level": 1})
	r = httptest.NewRequest("POST", "/v1/interviews/"+snapshot.ID+"/pass-stage", strings.NewReader(string(passBody)))
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("Origin", "https://quorem.test")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", postgres.ID())
	w = httptest.NewRecorder()
	(&httpapi.Server{Store: s, Local: true, Origins: []string{"https://quorem.test"}}).Handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("pass stage %d %s", w.Code, w.Body.String())
	}
	var passed interviews.Snapshot
	if err = json.Unmarshal(w.Body.Bytes(), &passed); err != nil {
		t.Fatal(err)
	}
	if !passed.Question.Progress.Completed || passed.Document != snapshot.Document {
		t.Fatal("manual HTTP completion", passed)
	}

}
