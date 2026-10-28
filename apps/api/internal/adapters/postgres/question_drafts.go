package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
func (s *Store) CreateQuestionDraft(ctx context.Context, actor string, content problems.QuestionContent) (QuestionDraft, error) {
	if err := s.requireQuestionAuthor(ctx, actor); err != nil {
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
	return scanQuestionDraft(s.Pool.QueryRow(ctx, "INSERT INTO question_drafts(content,created_by,updated_by,owner_id) SELECT $1,$2,$2,CASE WHEN role='admin' THEN NULL ELSE id END FROM users WHERE id=$2 RETURNING "+draftColumns, data, actor))
}
func (s *Store) QuestionDraft(ctx context.Context, id string) (QuestionDraft, error) {
	return scanQuestionDraft(s.Pool.QueryRow(ctx, "SELECT "+draftColumns+" FROM question_drafts WHERE id::text=$1 AND (owner_id=$2 OR (owner_id IS NULL AND $3))", id, identity.Subject(ctx).UserID, identity.Subject(ctx).Admin))
}
func (s *Store) QuestionDrafts(ctx context.Context, cursor string) (QuestionDraftPage, error) {
	query := `SELECT id::text,revision::text,COALESCE(content->'problem'->>'title',''),COALESCE(content->'problem'->>'slug',''),COALESCE(published_version_id::text,''),updated_at FROM question_drafts WHERE (owner_id=$2 OR (owner_id IS NULL AND $3)) AND ($1='' OR (updated_at,id)<(SELECT updated_at,id FROM question_drafts WHERE id::text=$1 AND (owner_id=$2 OR (owner_id IS NULL AND $3)))) ORDER BY updated_at DESC,id DESC LIMIT 51`
	rows, err := s.Pool.Query(ctx, query, cursor, identity.Subject(ctx).UserID, identity.Subject(ctx).Admin)
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
	if err := s.requireQuestionAuthor(ctx, actor); err != nil {
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
	d, err := scanQuestionDraft(s.Pool.QueryRow(ctx, "UPDATE question_drafts SET content=$1,revision=revision+1,updated_by=$2,updated_at=clock_timestamp() WHERE id::text=$3 AND revision::text=$4 AND published_version_id IS NULL AND (owner_id=$2 OR (owner_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND role='admin'))) RETURNING "+draftColumns, data, actor, id, revision))
	var missing *application.Error
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
	principal := identity.Subject(ctx)
	if !principal.Admin {
		var own bool
		if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=$1 AND p.owner_id=$2)`, versionID, principal.UserID).Scan(&own); err != nil {
			return problems.QuestionContent{}, err
		}
		if !own {
			return problems.QuestionContent{}, failure("forbidden", 403, "Only your own private questions can be cloned")
		}
	}
	p, err := s.Problem(ctx, versionID, true)
	if err != nil {
		return problems.QuestionContent{}, err
	}
	c := problems.QuestionContent{Problem: p.QuestionDefinition, HiddenCases: []problems.Case{}, Implementations: []problems.AuthoringImplementation{}, Solutions: []problems.EditorialSolution{}}
	var odyssey, suites []byte
	if err = s.Pool.QueryRow(ctx, "SELECT v.odyssey,"+odysseySuitesSQL+" FROM problem_versions v WHERE v.id::text=$1", versionID).Scan(&odyssey, &suites); err != nil {
		return c, err
	}
	if odyssey != nil {
		if err = json.Unmarshal(odyssey, &c.Problem.Odyssey); err != nil {
			return c, err
		}
	}
	if suites != nil {
		if err = json.Unmarshal(suites, &c.OdysseyHiddenCases); err != nil {
			return c, err
		}
	}

	if err = s.Pool.QueryRow(ctx, "SELECT attribution FROM problem_versions WHERE id::text=$1", versionID).Scan(&c.Attribution); err != nil {
		return c, err
	}
	rows, err := s.Pool.Query(ctx, "SELECT args,expected,calls FROM problem_test_cases WHERE version_id::text=$1 ORDER BY ordinal", versionID)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var args, expected, calls []byte
		var test problems.Case
		if err = rows.Scan(&args, &expected, &calls); err != nil {
			rows.Close()
			return c, err
		}
		if err = json.Unmarshal(args, &test.Args); err != nil {
			rows.Close()
			return c, err
		}
		test.Expected = expected
		if err = json.Unmarshal(calls, &test.Calls); err != nil {
			rows.Close()
			return c, err
		}
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
	c.Solutions, err = s.readSolutions(ctx, versionID)
	return c, err
}

func (s *Store) PublishQuestionDraft(ctx context.Context, actor, id, revision string) (QuestionDraft, error) {
	return s.PublishQuestionDraftTo(ctx, actor, id, revision, "")
}

func (s *Store) PublishQuestionDraftTo(ctx context.Context, actor, id, revision, visibility string) (QuestionDraft, error) {
	if visibility != "" && visibility != "private" && visibility != "global" {
		return QuestionDraft{}, failure("invalid_input", 400, "Choose private or global publication")
	}
	if err := s.requireQuestionAuthor(ctx, actor); err != nil {
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
	d, err := scanQuestionDraft(tx.QueryRow(ctx, "SELECT "+draftColumns+" FROM question_drafts WHERE id::text=$1 AND (owner_id=$2 OR (owner_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND role='admin'))) FOR UPDATE", id, actor))
	if err != nil {
		return d, err
	}
	if d.Revision != revision || d.PublishedVersionID != "" {
		return d, failure("revision_conflict", 409, "Draft changed or already published; reload it")
	}
	// Snapshot generated scaffolds with the immutable version; existing workspaces keep their drafts.
	c := d.Content
	methods := []problems.Signature{c.Problem.Signature}
	if c.Problem.Odyssey != nil && len(c.Problem.Odyssey.Levels) > 0 {
		methods = c.Problem.Odyssey.Levels[0].Methods
	}
	for i := range c.Implementations {
		starter, e := problems.GenerateStarter(methods, c.Implementations[i].Language, c.Problem.Odyssey != nil)
		if e != nil {
			return d, failure("invalid_input", 400, e.Error())
		}
		c.Implementations[i].StarterSource = starter
	}
	if err = problems.ValidateQuestionPublication(c); err != nil {
		return d, failure("invalid_input", 400, err.Error())
	}
	var privateOwner *string
	if err = tx.QueryRow(ctx, "SELECT owner_id FROM question_drafts WHERE id=$1", id).Scan(&privateOwner); err != nil {
		return d, err
	}
	if visibility == "global" {
		var admin bool
		if err = tx.QueryRow(ctx, "SELECT role='admin' FROM users WHERE id=$1 FOR SHARE", actor).Scan(&admin); err != nil {
			return d, err
		}
		if !admin {
			return d, failure("forbidden", 403, "Only administrators can publish globally")
		}
		c.Problem.Slug = strings.TrimPrefix(c.Problem.Slug, "private-"+Hash([]byte(actor))[:16]+"-")
		privateOwner = nil
	} else if visibility == "private" {
		privateOwner = &actor
	}
	if _, err = tx.Exec(ctx, "UPDATE question_drafts SET owner_id=$1 WHERE id=$2", privateOwner, id); err != nil {
		return d, err
	}
	if privateOwner == nil {
		var privateSlug bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problems WHERE slug=$1 AND owner_id IS NOT NULL)", c.Problem.Slug).Scan(&privateSlug); err != nil {
			return d, err
		}
		if privateSlug {
			return d, failure("invalid_input", 400, "Choose a new slug for global publication")
		}
	}
	if privateOwner != nil {
		// Namespace private slugs; a user cannot advance a global publication or another owner's version.
		baseSlug := strings.TrimPrefix(c.Problem.Slug, "private-"+Hash([]byte(*privateOwner))[:16]+"-")
		if len(baseSlug) > 96 {
			return d, failure("invalid_input", 400, "Private question slug must be 96 characters or fewer")
		}
		c.Problem.Slug = "private-" + Hash([]byte(*privateOwner))[:16] + "-" + baseSlug
		if _, err = tx.Exec(ctx, `INSERT INTO problems(slug,owner_id) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING`, c.Problem.Slug, *privateOwner); err != nil {
			return d, err
		}
		var ownNamespace bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM problems WHERE slug=$1 AND owner_id=$2)`, c.Problem.Slug, *privateOwner).Scan(&ownNamespace); err != nil {
			return d, err
		}
		if !ownNamespace {
			return d, failure("forbidden", 403, "Private question namespace unavailable")
		}
	}
	// Serialize new version numbers per slug across different admin drafts.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,740071))", c.Problem.Slug); err != nil {
		return d, err
	}
	var version int
	if err = tx.QueryRow(ctx, "SELECT COALESCE(MAX(v.version),0)+1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE p.slug=$1", c.Problem.Slug).Scan(&version); err != nil {
		return d, err
	}
	c.Problem.ID = ID()
	c.Problem.Version = strconv.Itoa(version)
	fixture, err := c.Fixture()
	if err != nil {
		return d, failure("invalid_input", 400, err.Error())
	}
	p := fixture.Problem
	primaryLanguage := "python"
	if p.SQL != nil {
		primaryLanguage = "postgresql"
	}
	inserted, err := insertProblemVersion(ctx, tx, fixture)
	if err != nil {
		return d, err
	}
	if !inserted {
		return d, failure("revision_conflict", 409, "Problem version already exists")
	}
	// Catalog metadata belongs to the stable problem, not its immutable version.
	if privateOwner != nil && p.LeetcodeID != nil {
		return d, failure("invalid_input", 400, "LeetCode IDs are reserved for global questions")
	}
	if privateOwner == nil {
		if _, err = tx.Exec(ctx, "UPDATE problems SET leetcode_id=$1 WHERE slug=$2", p.LeetcodeID, p.Slug); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return d, failure("invalid_input", 400, "LeetCode ID is already in use")
			}
			return d, err
		}
	}
	if p.Companies != nil {
		if _, err = tx.Exec(ctx, "DELETE FROM problem_companies WHERE problem_id=(SELECT id FROM problems WHERE slug=$1)", p.Slug); err != nil {
			return d, err
		}
		for _, company := range p.Companies {
			if _, err = tx.Exec(ctx, `INSERT INTO companies(name) VALUES($1) ON CONFLICT (lower(name)) DO NOTHING`, company); err != nil {
				return d, err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO problem_companies(problem_id,company_id) SELECT p.id,c.id FROM problems p JOIN companies c ON lower(c.name)=lower($2) WHERE p.slug=$1`, p.Slug, company); err != nil {
				return d, err
			}
		}
	}
	for _, v := range c.Implementations {
		if v.Language == primaryLanguage {
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
	c.Problem = p.QuestionDefinition
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

func (s *Store) requireQuestionAuthor(ctx context.Context, actor string) error {
	c, err := s.Capabilities(ctx, actor)
	if err != nil {
		return err
	}
	if !c.AuthorCustomQuestions {
		return failure("forbidden", 403, "Custom question access required")
	}
	return nil
}
