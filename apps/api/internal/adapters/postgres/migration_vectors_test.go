package postgres

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestMigrationOperationVectors(t *testing.T) {
	const id = "11111111-1111-4111-8111-111111111111"
	cases := []struct {
		name, route, scope, action string
		body                       any
	}{
		{"create", "POST /v1/interviews", "owner + key", "create", interviews.Create{Title: "<&>", Question: interviews.QuestionInput{ProblemVersionID: id, Language: "python"}}},
		{"create-monitoring", "POST /v1/interviews", "owner + key", "create", interviews.Create{Title: "<&>", Question: interviews.QuestionInput{ProblemVersionID: id, Language: "python"}, Monitoring: &interviews.Monitoring{}}},
		{"updates", "POST /v1/interviews/{id}/updates", "owner + key", id + ":updates", interviews.Push{Version: 9007199254740993, Epoch: id, Updates: []interviews.Update{{ClientID: "client", Changes: json.RawMessage(`[[0,"😀"]]`)}}}},
		{"language", "POST /v1/interviews/{id}/language", "owner + key", id + ":language", []string{"python", id}},
		{"submission-omitted", "POST /v1/interviews/{id}/submissions", "owner + key", id + ":submission", interviews.ExecutionCommand{Kind: "run", QuestionEpoch: id, DocumentEpoch: id, SourceHash: "abc"}},
		{"submission-empty", "POST /v1/interviews/{id}/submissions", "owner + key", id + ":submission", interviews.ExecutionCommand{Kind: "run", CustomCases: []problems.Case{}, QuestionEpoch: id, DocumentEpoch: id, SourceHash: "abc"}},
		{"submission-case", "POST /v1/interviews/{id}/submissions", "owner + key", id + ":submission", interviews.ExecutionCommand{Kind: "run", CustomCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1e2`)}}}, QuestionEpoch: id, DocumentEpoch: id, SourceHash: "abc"}},
	}
	type vector struct {
		Name     string `json:"name"`
		Route    string `json:"route"`
		Scope    string `json:"scope"`
		Action   string `json:"action"`
		Body     any    `json:"body"`
		BodyJSON string `json:"bodyJson"`
		Hash     string `json:"hash"`
	}
	var vectors []vector
	for _, c := range cases {
		body, err := json.Marshal(c.body)
		if err != nil {
			t.Fatal(err)
		}
		vectors = append(vectors, vector{c.name, c.route, c.scope, c.action, c.body, string(body), interviewFingerprint(c.action, c.body)})
	}
	if vectors[4].Hash != vectors[5].Hash || vectors[4].Hash == vectors[6].Hash || vectors[0].Hash == vectors[1].Hash {
		t.Fatal("unexpected omission or operation identity")
	}
	data, err := json.MarshalIndent(vectors, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := "../../../../../fixtures/migration/private/operation-oracle.json"
	if os.Getenv("QUOREM_UPDATE_MIGRATION_VECTORS") == "1" {
		if err = os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, want) {
		t.Fatal("operation vectors differ")
	}
}
