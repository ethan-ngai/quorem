package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestCaseStorageJSON(t *testing.T) {
	raw := []byte(`{"problem":{"title":"t","examples":[{"args":["a\u0000b", "\\u0000"],"expected":{"x\u0000y":"\u0000"}}]},"hiddenCases":[{"args":["\u0000\u0000"]}]}`)
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	safe, lossless, err := caseStorageJSON(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(lossless, raw) || !bytes.Equal(authoritativeJSON(safe, lossless), raw) {
		t.Fatal("lossless bytes changed")
	}
	var decoded any
	if err := json.Unmarshal(safe, &decoded); err != nil || containsNUL(decoded) {
		t.Fatalf("invalid projection: %s (%v)", safe, err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	if _, _, err := caseStorageJSON(raw, false); err == nil {
		t.Fatal("disabled gate accepted NUL")
	}
	if _, _, err := caseStorageJSON([]byte(`{"problem":{"title":"\u0000"}}`), false); err == nil {
		t.Fatal("accepted NUL outside case")
	}
	ordinary := []byte(`{"problem":{"title":"t"}}`)
	safe, lossless, err = caseStorageJSON(ordinary, false)
	if err != nil || lossless != nil || !bytes.Equal(safe, ordinary) {
		t.Fatal("changed ordinary payload")
	}
}

func TestRestoreProblemCasesKeepsStageVisibility(t *testing.T) {
	raw := []byte(`{"problem":{"examples":[{"args":["\u0000"]}],"odyssey":{"levels":[{"title":"one","examples":[{"args":["\u0000"]}]},{"title":"secret","examples":[{"args":["secret"]}]}]}}}`)
	p := problems.Problem{QuestionDefinition: problems.QuestionDefinition{Odyssey: &problems.Odyssey{Levels: []problems.OdysseyLevel{{Title: "visible"}}}}}
	if err := restoreProblemCases(&p, raw); err != nil {
		t.Fatal(err)
	}
	if len(p.Odyssey.Levels) != 1 || p.Odyssey.Levels[0].Title != "visible" || !bytes.Contains(p.Odyssey.Levels[0].Examples[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("unexpected restoration: %#v", p)
	}
}

func TestLosslessWorkspaceAdmissionAndClaim(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	f := copyProblemFixture(t, s, p.ID)
	f.Problem.Examples[0].Args = []json.RawMessage{json.RawMessage(`"a\u0000b"`)}
	f.Problem.Examples[0].Expected = json.RawMessage(`"b\u0000a"`)
	f.HiddenCases[0].Args = []json.RawMessage{json.RawMessage(`"x\u0000y"`)}
	f.HiddenCases[0].Expected = json.RawMessage(`"y\u0000x"`)
	f.ReferenceSource = "secret-reference-marker"
	insertTestProblem(t, s, f)
	var publicBytes []byte
	if err := s.Pool.QueryRow(ctx, `SELECT lossless_public FROM problem_versions WHERE id=$1`, f.Problem.ID).Scan(&publicBytes); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(publicBytes, []byte("secret-reference-marker")) || bytes.Contains(publicBytes, []byte(`x\u0000y`)) {
		t.Fatalf("private data in public projection: %s", publicBytes)
	}
	p, err = s.Problem(ctx, f.Problem.ID, true)
	if err != nil || !bytes.Contains(p.Examples[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("public example lost NUL: %+v %v", p.Examples, err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	sub, err := s.Admit(ctx, "alice", "lossless-admission", judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "source"}, "body")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	job, err := s.Claim(ctx)
	if err != nil || job.JobID != "" {
		t.Fatalf("disabled judge claimed job: %+v %v", job, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET attempt_id=$2 WHERE submission_id=$1`, sub.ID, ID()); err == nil {
		t.Fatal("legacy judge claimed lossless work")
	}
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	job, err = s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatalf("claim: %+v %v", job, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || !bytes.Contains(spec.Cases[0].Args[0], []byte(`\u0000`)) || !bytes.Contains(spec.SubmitSamples[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("execution lost NUL: %+v %v", spec, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET cases='[]'::jsonb WHERE id=$1`, sub.ID); err == nil {
		t.Fatal("active case cleanup accepted")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET state='cancelled' WHERE id=$1`, sub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET cases='[]'::jsonb WHERE id=$1`, sub.ID); err != nil {
		t.Fatalf("legacy cleanup: %v", err)
	}
	var scrubbed bool
	if err = s.Pool.QueryRow(ctx, `SELECT lossless_cases IS NULL FROM submissions WHERE id=$1`, sub.ID).Scan(&scrubbed); err != nil || !scrubbed {
		t.Fatalf("lossless cleanup: %v %v", scrubbed, err)
	}
}

func TestLosslessInterviewPrivateCases(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	s := interviewTestStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	f := copyProblemFixture(t, s, p.ID)
	f.Problem.Examples[0].Args = []json.RawMessage{json.RawMessage(`"a\u0000b"`)}
	f.Problem.Examples[0].Expected = json.RawMessage(`"b\u0000a"`)
	f.HiddenCases = []problems.Case{{Args: []json.RawMessage{json.RawMessage(`"x\u0000y"`)}, Expected: json.RawMessage(`"y\u0000x"`)}}
	insertTestProblem(t, s, f)
	room, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Lossless", Question: interviews.QuestionInput{ProblemVersionID: f.Problem.ID, Language: "python"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interviews SET question=question WHERE id=$1`, room.ID); err == nil {
		t.Fatal("legacy no-op interview write accepted")
	}
	no := false
	updated, err := s.SetInterviewHints(ctx, "alice", room.ID, ID(), problems.HintVisibility{Topics: &no})
	if err != nil || updated.Hints.TopicsAllowed() {
		t.Fatalf("hint update: %+v %v", updated.Hints, err)
	}
	if len(updated.Question.Problem.Examples) == 0 || !bytes.Contains(updated.Question.Problem.Examples[0].Args[0], []byte(`\u0000`)) {
		t.Fatal("hint update lost cases")
	}
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	sub, err := admitInterviewForTest(s, ctx, "bob", room.ID, ID(), "submit", nil)
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || !bytes.Contains(spec.Cases[0].Args[0], []byte(`\u0000`)) || !bytes.Contains(spec.SubmitSamples[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("interview cases: %+v %v", spec, err)
	}
	detail := []execution.PublicCaseResult{{Index: 0, Status: "accepted", Actual: json.RawMessage(`"y\u0000x"`), Expected: json.RawMessage(`"y\u0000x"`)}}
	samples := make([]execution.PublicCaseResult, len(spec.SubmitSamples))
	for i := range samples {
		samples[i] = execution.PublicCaseResult{Index: i, Status: "accepted"}
	}
	err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 1, Total: 1}, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}}, PrivateCaseResults: detail, SubmitSampleResults: samples})
	if err != nil {
		t.Fatal(err)
	}
	host, err := s.InterviewSubmission(ctx, "alice", room.ID, sub.ID)
	if err != nil || len(host.PrivateCaseResults) != 1 || !bytes.Contains(host.PrivateCaseResults[0].Expected, []byte(`\u0000`)) {
		t.Fatalf("host private detail: %+v %v", host, err)
	}
	guest, err := s.InterviewSubmission(ctx, "bob", room.ID, sub.ID)
	if err != nil || len(guest.PrivateCaseResults) != 0 {
		t.Fatalf("private case leaked: %+v %v", guest, err)
	}
}

func TestLosslessOdysseyUnlockedExamples(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	s := testStore(t)
	ctx := context.Background()
	data, err := os.ReadFile("../../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var c problems.QuestionContent
	if err = json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	c.Problem.Odyssey.Levels[0].Examples[0].Explanation = "first\x00example"
	c.Problem.Odyssey.Levels[1].Examples[0].Explanation = "second\x00example"
	f, err := c.Fixture()
	if err != nil {
		t.Fatal(err)
	}
	insertTestProblem(t, s, f)
	var firstStageBytes []byte
	if err = s.Pool.QueryRow(ctx, `SELECT lossless_public FROM problem_versions WHERE id=$1`, f.Problem.ID).Scan(&firstStageBytes); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(firstStageBytes, []byte("second")) {
		t.Fatalf("future stage in public projection: %s", firstStageBytes)
	}
	p, err := s.Problem(ctx, f.Problem.ID, true)
	if err != nil || len(p.Odyssey.Levels) != 1 || p.Odyssey.Levels[0].Examples[0].Explanation != "first\x00example" {
		t.Fatalf("initial public problem: %+v %v", p, err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", f.Problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	progress, err := s.Odyssey(ctx, "alice", w.ID)
	if err != nil || len(progress.Levels) != 1 || progress.Levels[0].Examples[0].Explanation != "first\x00example" {
		t.Fatalf("level one: %+v %v", progress, err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,2) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=2`, w.ID, f.Problem.ID); err != nil {
		t.Fatal(err)
	}
	progress, err = s.Odyssey(ctx, "alice", w.ID)
	if err != nil || len(progress.Levels) != 2 || progress.Levels[1].Examples[0].Explanation != "second\x00example" {
		t.Fatalf("level two: %+v %v", progress, err)
	}
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulties: []string{"easy"}, SelectedProblemVersionID: f.Problem.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "alice", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "bob", created.ID, ID(), true); err != nil {
		t.Fatal(err)
	}
	matchWorkspaceID := matchWorkspace(t, s, created.ID, "alice")
	matchProgress, err := s.Odyssey(ctx, "alice", matchWorkspaceID)
	if err != nil || len(matchProgress.Levels) != 1 || matchProgress.Levels[0].Examples[0].Explanation != "first\x00example" {
		t.Fatalf("match level one: %+v %v", matchProgress, err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,2) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=2`, matchWorkspaceID, f.Problem.ID); err != nil {
		t.Fatal(err)
	}
	matchProgress, err = s.Odyssey(ctx, "alice", matchWorkspaceID)
	if err != nil || len(matchProgress.Levels) != 2 || matchProgress.Levels[1].Examples[0].Explanation != "second\x00example" {
		t.Fatalf("match level two: %+v %v", matchProgress, err)
	}
}

func TestMatchCheckpointLosslessCaseRemainsUnknown(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	f := copyProblemFixture(t, s, p.ID)
	f.HiddenCases[0].Args = []json.RawMessage{json.RawMessage(`"x\u0000y"`)}
	f.HiddenCases[0].Expected = json.RawMessage(`"y\u0000x"`)
	insertTestProblem(t, s, f)
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulties: []string{"easy"}, SelectedProblemVersionID: f.Problem.ID})
	if err != nil {
		t.Fatal(err)
	}
	id := created.ID
	if _, err = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReadyMatch(ctx, "alice", id, ID(), true); err != nil {
		t.Fatal(err)
	}
	started, err := s.ReadyMatch(ctx, "bob", id, ID(), true)
	if err != nil || started.ProblemVersionID != f.Problem.ID {
		t.Fatalf("selected problem: %+v %v", started, err)
	}
	first := admitMatch(t, s, id, "alice", "submit")
	admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	var earlier, later execution.Job
	for _, job := range jobs {
		if job.SubmissionID == first.ID {
			earlier = job
		} else {
			later = job
		}
	}
	spec, err := s.LoadExecution(ctx, earlier)
	if err != nil || !bytes.Contains(spec.Cases[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("match case lost NUL: %+v %v", spec.Cases, err)
	}
	completeScore(t, s, later, 20)
	if err = s.SaveCheckpoint(ctx, earlier, execution.CheckpointCase{Ordinal: 0, Frame: json.RawMessage(`{"status":"runtime_error"}`)}); err != nil {
		t.Fatal(err)
	}
	var failed int
	if err = s.Pool.QueryRow(ctx, `SELECT definite_failures FROM execution_checkpoints WHERE job_id=$1`, earlier.JobID).Scan(&failed); err != nil || failed != 0 {
		t.Fatalf("lossless checkpoint failure bound: %d %v", failed, err)
	}
	match, err := s.Match(ctx, "alice", id)
	if err != nil || match.Outcome != nil {
		t.Fatalf("premature match outcome: %+v %v", match.Outcome, err)
	}
	completeScore(t, s, earlier, 19)
	match, err = s.Match(ctx, "alice", id)
	if err != nil || match.Outcome == nil || match.Outcome.Reason != "first_correct" {
		t.Fatalf("final match outcome: %+v %v", match.Outcome, err)
	}
}

func TestLosslessDraftRejectsLegacyWritesAndAllowsDelete(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET role='admin' WHERE id='alice'`); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var c problems.QuestionContent
	if err = json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	c.Problem.Odyssey.Levels[0].Examples[0].Explanation = "first\x00example"
	draft, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE question_drafts SET content=content,revision=revision+1 WHERE id=$1`, draft.ID); err == nil {
		t.Fatal("legacy no-op draft write accepted")
	}
	draft, err = s.UpdateQuestionDraft(ctx, "alice", draft.ID, draft.Revision, draft.Content)
	if err != nil || draft.Content.Problem.Odyssey.Levels[0].Examples[0].Explanation != "first\x00example" {
		t.Fatalf("capable writer: %+v %v", draft, err)
	}
	if _, err = s.Pool.Exec(ctx, `DELETE FROM question_drafts WHERE id=$1`, draft.ID); err != nil {
		t.Fatalf("legacy delete: %v", err)
	}
}
