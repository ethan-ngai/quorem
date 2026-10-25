package postgres

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

func interviewStarter(signature problems.Signature, language string) (string, error) {
	if language != "python" {
		return problems.Starter(signature, language)
	}
	args := []string{"self"}
	for _, p := range signature.Parameters {
		args = append(args, p.Name)
	}
	return "class " + signature.ClassName + ":\n    def " + signature.MethodName + "(" + strings.Join(args, ", ") + "):\n        raise NotImplementedError\n", nil
}
func (s *Store) SwitchInterviewLanguage(ctx context.Context, user, id, key, language, epoch string) (interviews.Snapshot, error) {
	var empty interviews.Snapshot
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, true)
	if err != nil {
		return empty, err
	}
	hash := interviewFingerprint(id+":language", []string{language, epoch})
	prior, _, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return empty, err
	}
	if prior != "" {
		return interviewSnapshot(ctx, tx, v)
	}
	if epoch != v.snapshot.Document.Epoch {
		return empty, failure("document_changed", 409, "Document changed; synchronize and retry")
	}
	var implementation *problems.LanguageImplementation
	for _, lang := range v.fixture.Problem.Languages {
		if lang.Language == language {
			copy := lang
			implementation = &copy
			break
		}
	}
	if implementation == nil {
		return empty, failure("invalid_input", 400, "Language unavailable for this question")
	}
	if language != v.language {
		if _, err = tx.Exec(ctx, `INSERT INTO interview_language_drafts(session_id,question_epoch,language,source) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,question_epoch,language) DO UPDATE SET source=EXCLUDED.source`, id, v.snapshot.QuestionEpoch, v.language, v.snapshot.Document.Source); err != nil {
			return empty, err
		}
		var source string
		err = tx.QueryRow(ctx, `SELECT source FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$2 AND language=$3`, id, v.snapshot.QuestionEpoch, language).Scan(&source)
		if err == pgx.ErrNoRows {
			source = implementation.StarterSource
		} else if err != nil {
			return empty, err
		}
		v.fixture.Problem.StarterSource = implementation.StarterSource
		v.fixture.Problem.RuntimeRevision = implementation.RuntimeRevision
		v.fixture.HarnessRevision = implementation.HarnessRevision
		data, _ := json.Marshal(v.fixture)
		if _, err = tx.Exec(ctx, `UPDATE interviews SET language=$2,source=$3,document_version=0,document_epoch=$4,question=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id, language, source, ID(), data); err != nil {
			return empty, err
		}
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.Interview(ctx, user, id)
}

func (s *Store) SetInterviewCaseVisibility(ctx context.Context, user, id, key, caseID string, revealed bool, questionEpoch ...string) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "case-visibility", struct {
		ID       string
		Revealed bool
		Epoch    []string
	}{caseID, revealed, questionEpoch}, func(tx pgx.Tx, v interviewRecord) error {
		if len(questionEpoch) > 0 && questionEpoch[0] != v.snapshot.QuestionEpoch {
			return failure("document_changed", 409, "Question changed; refresh test cases")
		}
		level := 1
		if v.fixture.Problem.Odyssey != nil {
			level = len(v.fixture.Problem.Odyssey.Levels)
		}
		found := false
		for _, c := range interviewPrivateCases(v.fixture, level) {
			if c.ID == caseID {
				found = true
				break
			}
		}
		if !found {
			return failure("not_found", 404, "Test case unavailable")
		}
		if revealed {
			_, err := tx.Exec(ctx, `INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, id, v.snapshot.QuestionEpoch, caseID)
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM interview_case_visibility WHERE session_id=$1 AND question_epoch=$2 AND case_id=$3`, id, v.snapshot.QuestionEpoch, caseID)
		return err
	})
}
