package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

type QuestionDraft = problems.QuestionDraft
type QuestionDraftSummary = problems.QuestionDraftSummary
type QuestionDraftPage = problems.QuestionDraftPage

const draftColumns = "id::text,revision::text,content,COALESCE(published_version_id::text,''),updated_at"

func scanQuestionDraft(row pgx.Row) (QuestionDraft, error) {
	var d QuestionDraft
	var data []byte
	err := row.Scan(&d.ID, &d.Revision, &data, &d.PublishedVersionID, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, failure("not_found", 404, "Question draft not found")
	}
	if err == nil {
		err = json.Unmarshal(data, &d.Content)
	}
	return d, err
}
func (s *Store) requireQuestionAdmin(ctx context.Context, actor string) error {
	var admin bool
	err := s.Pool.QueryRow(ctx, "SELECT role='admin' AND NOT disabled FROM users WHERE id=$1", actor).Scan(&admin)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !admin {
		return failure("forbidden", 403, "Administrator required")
	}
	return err
}
func (s *Store) CreateQuestionDraft(ctx context.Context, actor string, content problems.QuestionContent) (QuestionDraft, error) {
	if err := s.requireQuestionAdmin(ctx, actor); err != nil {
		return QuestionDraft{}, err
	}
	content = problems.NormalizeQuestionDraft(content)
	if err := problems.ValidateQuestionDraft(content); err != nil {
		return QuestionDraft{}, failure("invalid_input", 400, err.Error())
	}
	data, err := json.Marshal(content)
	if err != nil {
		return QuestionDraft{}, err
	}
	return scanQuestionDraft(s.Pool.QueryRow(ctx, "INSERT INTO question_drafts(content,created_by,updated_by) VALUES($1,$2,$2) RETURNING "+draftColumns, data, actor))
}
func (s *Store) QuestionDraft(ctx context.Context, id string) (QuestionDraft, error) {
	return scanQuestionDraft(s.Pool.QueryRow(ctx, "SELECT "+draftColumns+" FROM question_drafts WHERE id::text=$1", id))
}
func (s *Store) QuestionDrafts(ctx context.Context, cursor string) (QuestionDraftPage, error) {
	query := `SELECT id::text,revision::text,COALESCE(content->'problem'->>'title',''),COALESCE(content->'problem'->>'slug',''),COALESCE(published_version_id::text,''),updated_at FROM question_drafts WHERE $1='' OR (updated_at,id)<(SELECT updated_at,id FROM question_drafts WHERE id::text=$1) ORDER BY updated_at DESC,id DESC LIMIT 51`
	rows, err := s.Pool.Query(ctx, query, cursor)
	if err != nil {
		return QuestionDraftPage{}, err
	}
	defer rows.Close()
	page := QuestionDraftPage{Items: []QuestionDraftSummary{}}
	for rows.Next() {
		var d QuestionDraftSummary
		if err = rows.Scan(&d.ID, &d.Revision, &d.Title, &d.Slug, &d.PublishedVersionID, &d.UpdatedAt); err != nil {
			return page, err
		}
		page.Items = append(page.Items, d)
	}
	if len(page.Items) > 50 {
		page.Items = page.Items[:50]
		page.NextCursor = page.Items[49].ID
	}
	return page, rows.Err()
}
func validDraftRevision(revision string) bool {
	v, err := strconv.ParseInt(revision, 10, 64)
	return err == nil && v > 0 && strconv.FormatInt(v, 10) == revision
}
func (s *Store) UpdateQuestionDraft(ctx context.Context, actor, id, revision string, content problems.QuestionContent) (QuestionDraft, error) {
	if err := s.requireQuestionAdmin(ctx, actor); err != nil {
		return QuestionDraft{}, err
	}
	if !validDraftRevision(revision) {
		return QuestionDraft{}, failure("invalid_input", 400, "Invalid draft revision")
	}
	content = problems.NormalizeQuestionDraft(content)
	if err := problems.ValidateQuestionDraft(content); err != nil {
		return QuestionDraft{}, failure("invalid_input", 400, err.Error())
	}
	data, err := json.Marshal(content)
	if err != nil {
		return QuestionDraft{}, err
	}
	d, err := scanQuestionDraft(s.Pool.QueryRow(ctx, "UPDATE question_drafts SET content=$1,revision=revision+1,updated_by=$2,updated_at=clock_timestamp() WHERE id::text=$3 AND revision::text=$4 AND published_version_id IS NULL RETURNING "+draftColumns, data, actor, id, revision))
	var missing *Error
	if errors.As(err, &missing) && missing.Code == "not_found" {
		if _, e := s.QuestionDraft(ctx, id); e != nil {
			return d, e
		}
		return d, failure("revision_conflict", 409, "Draft changed or already published; reload it")
	}
	return d, err
}

// Fork normalized content, preserving private authoring fields only behind admin routes.
func (s *Store) QuestionContent(ctx context.Context, versionID string) (problems.QuestionContent, error) {
	p, err := s.Problem(ctx, versionID, true)
	if err != nil {
		return problems.QuestionContent{}, err
	}
	c := problems.QuestionContent{Problem: p, HiddenCases: []problems.Case{}, Implementations: []problems.AuthoringImplementation{}, Solutions: []problems.EditorialSolution{}}
	if err = s.Pool.QueryRow(ctx, "SELECT comparator,attribution FROM problem_versions WHERE id::text=$1", versionID).Scan(&c.Comparator, &c.Attribution); err != nil {
		return c, err
	}
	rows, err := s.Pool.Query(ctx, "SELECT args,expected FROM problem_test_cases WHERE version_id::text=$1 ORDER BY ordinal", versionID)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var args, expected []byte
		var test problems.Case
		if err = rows.Scan(&args, &expected); err != nil {
			rows.Close()
			return c, err
		}
		if err = json.Unmarshal(args, &test.Args); err != nil {
			rows.Close()
			return c, err
		}
		test.Expected = expected
		c.HiddenCases = append(c.HiddenCases, test)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return c, err
	}
	rows, err = s.Pool.Query(ctx, "SELECT language,starter_source,runtime_revision,harness_revision,reference_source FROM problem_languages WHERE version_id::text=$1 ORDER BY language", versionID)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var v problems.AuthoringImplementation
		if err = rows.Scan(&v.Language, &v.StarterSource, &v.RuntimeRevision, &v.HarnessRevision, &v.ReferenceSource); err != nil {
			rows.Close()
			return c, err
		}
		c.Implementations = append(c.Implementations, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return c, err
	}
	c.Solutions, err = s.Solutions(ctx, versionID)
	return c, err
}

func (s *Store) PublishQuestionDraft(ctx context.Context, actor, id, revision string) (QuestionDraft, error) {
	if err := s.requireQuestionAdmin(ctx, actor); err != nil {
		return QuestionDraft{}, err
	}
	if !validDraftRevision(revision) {
		return QuestionDraft{}, failure("invalid_input", 400, "Invalid draft revision")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return QuestionDraft{}, err
	}
	defer tx.Rollback(ctx)
	d, err := scanQuestionDraft(tx.QueryRow(ctx, "SELECT "+draftColumns+" FROM question_drafts WHERE id::text=$1 FOR UPDATE", id))
	if err != nil {
		return d, err
	}
	if d.Revision != revision || d.PublishedVersionID != "" {
		return d, failure("revision_conflict", 409, "Draft changed or already published; reload it")
	}
	if err = problems.ValidateQuestionPublication(d.Content); err != nil {
		return d, failure("invalid_input", 400, err.Error())
	}
	c := d.Content
	// Serialize new version numbers per slug across different admin drafts.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,740071))", c.Problem.Slug); err != nil {
		return d, err
	}
	var version int
	if err = tx.QueryRow(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM problem_versions WHERE slug=$1", c.Problem.Slug).Scan(&version); err != nil {
		return d, err
	}
	p := c.Problem
	p.ID = ID()
	p.Version = strconv.Itoa(version)
	p.Languages = []problems.LanguageImplementation{}
	var python problems.AuthoringImplementation
	for _, v := range c.Implementations {
		p.Languages = append(p.Languages, v.LanguageImplementation)
		if v.Language == "python" {
			python = v
		}
	}
	p.StarterSource = python.StarterSource
	p.RuntimeRevision = python.RuntimeRevision
	fixture := problems.Fixture{Problem: p, HarnessRevision: python.HarnessRevision, Comparator: c.Comparator, Attribution: c.Attribution, HiddenCases: c.HiddenCases, ReferenceSource: python.ReferenceSource}
	public, err := json.Marshal(p)
	if err != nil {
		return d, err
	}
	private, err := json.Marshal(fixture)
	if err != nil {
		return d, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO problem_versions(id,slug,version,public,fixture) VALUES($1,$2,$3,$4,$5)", p.ID, p.Slug, version, public, private); err != nil {
		return d, err
	}
	for _, v := range c.Implementations {
		if v.Language == "python" {
			continue
		}
		if _, err = tx.Exec(ctx, `INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,$2,$3,$4,$5,$6)`, p.ID, v.Language, v.StarterSource, v.RuntimeRevision, v.HarnessRevision, v.ReferenceSource); err != nil {
			return d, err
		}
	}
	for _, v := range c.Solutions {
		if _, err = tx.Exec(ctx, `INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES($1,$2,$3,$4,$5,$6,$7)`, p.ID, v.Language, v.Source, v.ExplanationMarkdown, v.TimeComplexity, v.SpaceComplexity, v.ComplexityNotes); err != nil {
			return d, err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE problem_versions SET sealed=true WHERE id=$1", p.ID); err != nil {
		return d, err
	}
	c.Problem = p
	content, err := json.Marshal(c)
	if err != nil {
		return d, err
	}
	d, err = scanQuestionDraft(tx.QueryRow(ctx, "UPDATE question_drafts SET published_version_id=$1,content=$2,revision=revision+1,updated_by=$3,updated_at=clock_timestamp() WHERE id::text=$4 RETURNING "+draftColumns, p.ID, content, actor, id))
	if err != nil {
		return d, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'questions.publish',$3,'Explicit publication')", "publish:"+p.ID, actor, id); err != nil {
		return d, err
	}
	if err = tx.Commit(ctx); err != nil {
		return d, err
	}
	return d, nil
}
