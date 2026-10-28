package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestInterviewSubmissionPrivateVerdictsStayOutOfGenericEndpoints(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'alice','interviews.host','manual','private-test','test','test')`); err != nil {
		t.Fatal(err)
	}
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	room, err := store.CreateInterview(ctx, "alice", postgres.ID(), interviews.Create{Title: "Privacy", Question: interviews.QuestionInput{Language: "python", ProblemVersionID: problem.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	command := interviews.ExecutionCommand{Level: 1, Kind: "submit", QuestionEpoch: room.QuestionEpoch, DocumentEpoch: room.Document.Epoch, SourceHash: postgres.Hash([]byte(room.Document.Source))}
	submission, err := store.AdmitInterview(ctx, "bob", room.ID, postgres.ID(), command)
	if err != nil {
		t.Fatal(err)
	}
	job, err := store.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	hidden := make([]execution.HiddenCaseResult, 20)
	for i := range hidden {
		hidden[i] = execution.HiddenCaseResult{Index: i, Status: execution.WrongAnswer}
	}
	if err = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.WrongAnswer, Score: &execution.Score{Passed: 0, Total: 20}, HiddenCases: hidden}); err != nil {
		t.Fatal(err)
	}
	bus := realtime.NewMemory()
	defer bus.Close()
	server := httptest.NewServer((&Server{Store: store, Local: true, Events: bus}).Handler())
	defer server.Close()
	get := func(path, user string) judging.Submission {
		t.Helper()
		req, err := http.NewRequest("GET", server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Dev-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: %s", path, resp.Status)
		}
		var got judging.Submission
		if err = json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	generic := get("/v1/submissions/"+submission.ID, "bob")
	if generic.State != "completed" || len(generic.HiddenCases) != 0 || generic.Score == nil {
		t.Fatalf("generic result: %+v", generic)
	}
	candidate := get("/v1/interviews/"+room.ID+"/submissions/"+submission.ID, "bob")
	if len(candidate.HiddenCases) != 0 || len(candidate.PrivateCaseResults) != 0 {
		t.Fatalf("candidate result: %+v", candidate)
	}
	staff := get("/v1/interviews/"+room.ID+"/submissions/"+submission.ID, "alice")
	if len(staff.HiddenCases) != 20 || len(staff.PrivateCaseResults) != 20 {
		t.Fatalf("staff result: %+v", staff)
	}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/submissions/"+submission.ID+"/events?user=bob", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:5173"}, "X-Dev-User": []string{"bob"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	streamed := readSubmission(t, conn, "completed")
	if len(streamed.HiddenCases) != 0 || streamed.Score == nil {
		t.Fatalf("streamed result: %+v", streamed)
	}
}
