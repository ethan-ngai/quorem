package postgres

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestQuestionDefinitionMigrationPreservesAuthoredImplementations(t *testing.T) {
	s := adminStore(t)
	ctx := context.Background()
	draft, err := s.CreateQuestionDraft(ctx, "alice", authoringContent(t, s))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(ctx, `UPDATE question_drafts SET content=jsonb_set(content,'{problem}',content->'problem' || '{"starterSource":"obsolete","runtimeRevision":"obsolete","languages":[],"isPrivate":true,"solutionLanguages":["python"],"complexityLanguages":["python"]}'::jsonb) WHERE id=$1`, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../migrations/039_question_definition.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var data []byte
	var revision string
	if err = s.Pool.QueryRow(ctx, `SELECT content,revision::text FROM question_drafts WHERE id=$1`, draft.ID).Scan(&data, &revision); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Problem         map[string]json.RawMessage `json:"problem"`
		Implementations []json.RawMessage          `json:"implementations"`
	}
	if err = json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"starterSource", "runtimeRevision", "languages", "isPrivate", "solutionLanguages", "complexityLanguages"} {
		if _, exists := result.Problem[field]; exists {
			t.Fatalf("legacy field %s retained", field)
		}
	}
	want, err := json.Marshal(draft.Content.Implementations)
	if err != nil {
		t.Fatal(err)
	}
	var implementations []json.RawMessage
	if err = json.Unmarshal(want, &implementations); err != nil {
		t.Fatal(err)
	}
	for i, value := range result.Implementations {
		var got, expected any
		if i >= len(implementations) || json.Unmarshal(value, &got) != nil || json.Unmarshal(implementations[i], &expected) != nil || !reflect.DeepEqual(got, expected) {
			t.Fatal("migration changed authored implementation", i)
		}
	}
	if revision != draft.Revision || len(result.Implementations) != len(implementations) {
		t.Fatal("migration changed authored implementations or revision")
	}
}
