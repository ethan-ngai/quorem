package postgres

import (
	"context"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

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
	if err = enableLosslessCaseWrites(ctx, tx); err != nil {
		return empty, err
	}
	if language != v.language {
		if _, err = tx.Exec(ctx, `INSERT INTO interview_language_drafts(session_id,question_epoch,language,source) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,question_epoch,language) DO UPDATE SET source=EXCLUDED.source`, id, v.snapshot.QuestionEpoch, v.language, v.snapshot.Document.Source); err != nil {
			return empty, err
		}
		var source string
		err = tx.QueryRow(ctx, `DELETE FROM interview_language_drafts WHERE session_id=$1 AND question_epoch=$2 AND language=$3 RETURNING source`, id, v.snapshot.QuestionEpoch, language).Scan(&source)
		if err == pgx.ErrNoRows {
			source = implementation.StarterSource
		} else if err != nil {
			return empty, err
		}
		v.fixture.Problem.StarterSource = implementation.StarterSource
		v.fixture.Problem.RuntimeRevision = implementation.RuntimeRevision
		v.fixture.HarnessRevision = implementation.HarnessRevision
		data, _ := encodeInterviewQuestion(v.fixture, v.snapshot.Hints)
		data, lossless, err := caseStorageJSON(data, false)
		if err != nil {
			return empty, err
		}
		if _, err = tx.Exec(ctx, `UPDATE interviews SET language=$2,source=$3,document_version=0,document_epoch=$4,question=$5,lossless_question=$6,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, id, language, source, ID(), data, lossless); err != nil {
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

// PassInterviewStage advances shared progress without changing code or question epochs.
func (s *Store) PassInterviewStage(ctx context.Context, user, id, key, epoch string, level int) (interviews.Snapshot, error) {
	return s.mutateInterview(ctx, user, id, key, "pass-stage", struct {
		Epoch string
		Level int
	}{epoch, level}, func(tx pgx.Tx, v interviewRecord) error {
		if epoch != v.snapshot.QuestionEpoch {
			return failure("document_changed", 409, "Question changed; refresh before passing a stage")
		}
		if v.fixture.Problem.Odyssey == nil {
			return failure("invalid_input", 400, "Question has no stages")
		}

		current, completed, err := interviewProgress(ctx, tx, v)
		if err != nil {
			return err
		}
		if level != current || completed {
			return failure("stale_version", 409, "Stage changed; refresh before passing a stage")
		}
		total := len(v.fixture.Problem.Odyssey.Levels)
		next := min(level+1, total)
		// Judge completion can race this command; only advance the displayed stage once.
		tag, err := tx.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id,level,completed) VALUES($1,$2,$3,$4) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=EXCLUDED.level,completed=EXCLUDED.completed WHERE odyssey_progress.level=$5 AND NOT odyssey_progress.completed`, epoch, v.fixture.Problem.ID, next, level == total, level)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return failure("stale_version", 409, "Stage changed; refresh before passing a stage")
		}
		return nil
	})
}
