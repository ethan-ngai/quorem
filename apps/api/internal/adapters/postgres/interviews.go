package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

type interviewRecord struct {
	snapshot                          interviews.Snapshot
	fixture                           problems.Fixture
	language, token, interviewerToken string
}

func lockInterview(ctx context.Context, tx pgx.Tx, user, id string, manage, active bool) (interviewRecord, error) {
	var v interviewRecord
	var data []byte
	var disabled bool
	var complexityLanguages []string
	err := tx.QueryRow(ctx, `SELECT i.id,i.title,i.state,i.host_id,i.language,i.source,i.document_version,i.document_epoch,i.version,i.question,i.invite_token,i.question_epoch,i.interviewer_invite_token,m.role,h.disabled,ARRAY(SELECT ps.language FROM problem_solutions ps WHERE ps.version_id=NULLIF(i.question->'problem'->>'id','')::uuid AND COALESCE(i.question->'problem'->'odyssey','null'::jsonb)='null'::jsonb AND btrim(ps.time_complexity)<>'' AND btrim(ps.space_complexity)<>'' ORDER BY ps.language) FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=$2 AND m.removed_at IS NULL JOIN users h ON h.id=i.host_id JOIN users u ON u.id=m.user_id AND NOT u.disabled WHERE i.id::text=$1 AND i.deleted_at IS NULL FOR UPDATE OF i`, id, user).Scan(&v.snapshot.ID, &v.snapshot.Title, &v.snapshot.State, &v.snapshot.HostID, &v.language, &v.snapshot.Document.Source, &v.snapshot.Document.Version, &v.snapshot.Document.Epoch, &v.snapshot.Version, &data, &v.token, &v.snapshot.QuestionEpoch, &v.interviewerToken, &v.snapshot.Role, &disabled, &complexityLanguages)
	if err == pgx.ErrNoRows {
		return v, failure("not_found", 404, "Interview unavailable")
	}
	if err != nil {
		return v, err
	}
	if disabled {
		return v, failure("forbidden", 403, "Interview unavailable")
	}
	if manage && v.snapshot.Role != "interviewer" {
		return v, failure("forbidden", 403, "Interviewer access required")
	}
	if active && v.snapshot.State != "active" {
		return v, failure("invalid_transition", 409, "Interview is closed")
	}
	var presentation struct {
		Hints *problems.HintVisibility `json:"hints,omitempty"`
	}
	if err = json.Unmarshal(data, &presentation); err != nil {
		return v, err
	}
	v.snapshot.Hints = presentation.Hints
	if err = json.Unmarshal(data, &v.fixture); err != nil {
		return v, err
	}
	v.fixture.Problem.ComplexityLanguages = complexityLanguages
	// Revoking the host flag freezes writes and invitations, but preserves member readback.
	if active {
		var enabled bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','interviews.host') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()))`, v.snapshot.HostID).Scan(&enabled)
		if err != nil {
			return v, err
		}
		if !enabled {
			return v, failure("entitlement_required", 403, "Interview access is disabled")
		}
	}
	return v, nil
}

// Presentation settings live beside the private fixture in the session's question JSONB.
func encodeInterviewQuestion(f problems.Fixture, hints *problems.HintVisibility) ([]byte, error) {
	return json.Marshal(struct {
		problems.Fixture
		Hints *problems.HintVisibility `json:"hints,omitempty"`
	}{f, hints})
}
func interviewSnapshot(ctx context.Context, tx pgx.Tx, v interviewRecord) (interviews.Snapshot, error) {
	out := v.snapshot
	out.Question = interviews.Question{Problem: v.fixture.Problem, Language: v.language}
	out.Members = []interviews.Member{}
	out.Question.Languages = []string{}
	for _, implementation := range v.fixture.Problem.Languages {
		out.Question.Languages = append(out.Question.Languages, implementation.Language)
	}
	if v.fixture.Problem.Odyssey != nil {
		level, completed, err := interviewProgress(ctx, tx, v)
		if err != nil {
			return out, err
		}
		p, _, err := problems.CompileOdyssey(v.fixture, level, "run")
		if err != nil {
			return out, err
		}
		out.Question.Problem = p
		out.Question.Progress = &interviews.Progress{Level: level, Completed: completed, Levels: p.Odyssey.Levels, TotalLevels: len(v.fixture.Problem.Odyssey.Levels)}
	}

	if err := tx.QueryRow(ctx, `SELECT COALESCE((SELECT e.submission_id::text FROM interview_execution e JOIN submissions s ON s.id=e.submission_id JOIN interviews i ON i.id=e.session_id WHERE e.session_id=$1 AND e.question_epoch=i.question_epoch AND EXISTS(SELECT 1 FROM execution_jobs j WHERE j.submission_id=e.submission_id AND j.language=i.language) ORDER BY s.admitted_at DESC LIMIT 1),'')`, out.ID).Scan(&out.LatestSubmissionID); err != nil {
		return out, err
	}
	if out.Role == "interviewer" {
		out.Question.PrivateCases = v.fixture.HiddenCases
		if v.fixture.Problem.Odyssey != nil {
			_, tests, err := problems.CompileOdyssey(v.fixture, len(v.fixture.Problem.Odyssey.Levels), "submit")
			if err != nil {
				return out, err
			}
			out.Question.PrivateCases = tests
		}
		out.InvitePath = "/interview-invite/" + v.token
		out.Invites = &interviews.InvitePaths{Interviewer: "/interview-invite/" + v.interviewerToken, Interviewee: out.InvitePath}
	}
	if err := interviewCaseProjection(ctx, tx, v, &out); err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, `SELECT m.user_id,u.display_name,m.role,u.kind='guest' FROM interview_members m JOIN users u ON u.id=m.user_id WHERE m.session_id=$1 AND m.removed_at IS NULL ORDER BY m.role,m.user_id`, out.ID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var m interviews.Member
		if err = rows.Scan(&m.UserID, &m.Name, &m.Role, &m.Guest); err != nil {
			return out, err
		}
		out.Members = append(out.Members, m)
	}
	return out, rows.Err()
}
func (s *Store) Interview(ctx context.Context, user, id string) (interviews.Snapshot, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return interviews.Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, false)
	if err != nil {
		return interviews.Snapshot{}, err
	}
	out, err := interviewSnapshot(ctx, tx, v)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func (s *Store) Interviews(ctx context.Context, user string) ([]interviews.Snapshot, error) {
	rows, err := s.Pool.Query(ctx, `SELECT i.id FROM interviews i JOIN interview_members m ON m.session_id=i.id WHERE m.user_id=$1 AND m.removed_at IS NULL AND i.deleted_at IS NULL ORDER BY i.updated_at DESC LIMIT 50`, user)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []interviews.Snapshot{}
	for _, id := range ids {
		v, e := s.Interview(ctx, user, id)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, nil
}
func interviewFingerprint(action string, body any) string {
	data, _ := json.Marshal(body)
	return Hash(append([]byte(action+":"), data...))
}
func priorInterviewOperation(ctx context.Context, tx pgx.Tx, user, key, hash string) (string, []byte, error) {
	if key == "" || len(key) > 128 {
		return "", nil, failure("invalid_input", 400, "Idempotency-Key required")
	}
	var id, prior string
	var data []byte
	err := tx.QueryRow(ctx, `SELECT session_id,fingerprint,response FROM interview_operations WHERE owner_id=$1 AND key=$2`, user, key).Scan(&id, &prior, &data)
	if err == pgx.ErrNoRows {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	if prior != hash {
		return "", nil, failure("idempotency_conflict", 409, "Key was used for another operation")
	}
	return id, data, nil
}
func saveInterviewOperation(ctx context.Context, tx pgx.Tx, user, key, hash, id string, response any) error {
	data, _ := json.Marshal(response)
	_, err := tx.Exec(ctx, `INSERT INTO interview_operations(owner_id,key,fingerprint,session_id,response) VALUES($1,$2,$3,$4,$5)`, user, key, hash, id, data)
	return err
}
func (s *Store) CreateInterview(ctx context.Context, user, key string, c interviews.Create) (interviews.Snapshot, error) {
	var empty interviews.Snapshot
	c.Title = strings.TrimSpace(c.Title)
	if c.Title == "" || utf8.RuneCountInString(c.Title) > 120 {
		return empty, failure("invalid_input", 400, "Choose an interview title up to 120 characters")
	}
	f, err := s.interviewQuestion(ctx, user, c.Question)
	if err != nil {
		return empty, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	var enabled bool
	err = tx.QueryRow(ctx, `SELECT kind='account' AND NOT disabled AND EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','interviews.host') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())) FROM users WHERE id=$1 FOR UPDATE`, user).Scan(&enabled)
	if err != nil {
		return empty, err
	}
	if !enabled {
		return empty, failure("entitlement_required", 403, "Interview hosting is unavailable")
	}
	if c.Question.Custom != nil {
		caps, e := capabilities(ctx, tx, user)
		if e != nil {
			return empty, e
		}
		if !caps.AuthorCustomQuestions {
			return empty, failure("forbidden", 403, "Custom question access required")
		}
	}
	if err = requireInterviewOdyssey(ctx, tx, user, f); err != nil {
		return empty, err
	}
	hash := interviewFingerprint("create", c)
	prior, _, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return empty, err
	}
	if prior != "" {
		v, e := lockInterview(ctx, tx, user, prior, false, false)
		if e != nil {
			return empty, e
		}
		return interviewSnapshot(ctx, tx, v)
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM interviews WHERE host_id=$1 AND state='active'`, user).Scan(&count); err != nil {
		return empty, err
	}
	caps, err := capabilities(ctx, tx, user)
	if err != nil {
		return empty, err
	}
	if count >= caps.InterviewConcurrency {
		return empty, failure("quota_exceeded", 429, "End an interview before creating another")
	}
	if c.Question.Custom != nil {
		if err = saveInterviewCustomQuestion(ctx, tx, user, f); err != nil {
			return empty, err
		}
	}
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return empty, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	id := ID()
	questionEpoch := ID()
	if _, err = rand.Read(raw); err != nil {
		return empty, err
	}
	interviewerToken := base64.RawURLEncoding.EncodeToString(raw)
	data, _ := encodeInterviewQuestion(f, c.Question.Hints)
	if _, err = tx.Exec(ctx, `INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,invite_hash,invite_token,question_epoch,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, id, user, c.Title, data, c.Question.Language, f.Problem.StarterSource, ID(), Hash([]byte(token)), token, questionEpoch, Hash([]byte(interviewerToken)), interviewerToken); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer')`, id, user); err != nil {
		return empty, err
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.Interview(ctx, user, id)
}
func (s *Store) interviewQuestion(ctx context.Context, actor string, q interviews.QuestionInput) (problems.Fixture, error) {
	var f problems.Fixture
	runtime, ok := execution.LanguageRuntime(q.Language)
	if !ok {
		return f, failure("invalid_input", 400, "Unsupported language")
	}
	if (q.Custom == nil) == (q.ProblemVersionID == "") {
		return f, failure("invalid_input", 400, "Choose an existing question or custom question")
	}
	if q.Custom == nil {
		if _, err := s.Problem(identity.With(ctx, identity.Principal{UserID: actor}), q.ProblemVersionID, true); err != nil {
			return f, err
		}
		var data []byte
		err := s.Pool.QueryRow(ctx, `SELECT v.fixture FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=$1 AND p.current_version_id=v.id`, q.ProblemVersionID).Scan(&data)
		if err == pgx.ErrNoRows {
			return f, failure("not_found", 404, "Question unavailable")
		}
		if err != nil {
			return f, err
		}
		if err = json.Unmarshal(data, &f); err != nil {
			return f, err
		}
		p, err := s.Problem(identity.With(ctx, identity.Principal{UserID: actor}), q.ProblemVersionID, true)
		if err != nil {
			return f, err
		}
		fullOdyssey := f.Problem.Odyssey
		f.Problem = p
		f.Problem.Odyssey = fullOdyssey
		found := false
		for _, lang := range p.Languages {
			if lang.Language == q.Language {
				found = true
				f.Problem.StarterSource = lang.StarterSource
				f.Problem.RuntimeRevision = lang.RuntimeRevision
				f.HarnessRevision = lang.HarnessRevision
			}
		}
		if !found {
			return f, failure("invalid_input", 400, "Language unavailable for this question")
		}
		return f, nil
	}
	c := q.Custom
	f = problems.Fixture{Problem: problems.Problem{ID: ID(), Slug: "interview-private", Version: "1", Title: strings.TrimSpace(c.Title), Difficulty: "easy", Tags: []string{}, StatementMarkdown: c.StatementMarkdown, Signature: c.Signature, StarterSource: c.StarterSource, RuntimeRevision: runtime.Revision, Limits: execution.DefaultLimits(), Constraints: []problems.Constraint{}, Examples: []problems.ProblemExample{}}, HiddenCases: c.PrivateCases, HarnessRevision: runtime.Harness, Comparator: "ordered", Attribution: "Private interview"}
	if f.Problem.Signature.ClassName == "" {
		f.Problem.Signature.ClassName = "Solution"
	}
	for _, test := range c.PublicCases {
		f.Problem.Examples = append(f.Problem.Examples, problems.ProblemExample{Case: test})
	}
	if c.Odyssey != nil || c.OdysseyHiddenCases != nil {
		if err := validateCustomInterviewStages(&f, c); err != nil {
			return f, failure("invalid_input", 400, err.Error())
		}
	} else {
		// Reuse authoring/type validation without publishing private content or requiring a reference solution.
		validation := problems.QuestionContent{Problem: f.Problem, HiddenCases: []problems.Case{}, Comparator: "ordered", Attribution: f.Attribution, Implementations: []problems.AuthoringImplementation{{LanguageImplementation: problems.LanguageImplementation{Language: "python", StarterSource: "private", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision}, ReferenceSource: "private"}}}
		validation.Problem.Slug = "interview-private"
		if len(c.PublicCases) == 0 || len(c.PublicCases) > 20 || len(c.PrivateCases) > 100 {
			return f, failure("invalid_input", 400, "Provide 1-20 public tests and at most 100 private tests")
		}
		for len(validation.HiddenCases) < 20 {
			validation.HiddenCases = append(validation.HiddenCases, c.PublicCases[0])
		}
		if err := problems.ValidateQuestionPublication(validation); err != nil {
			return f, failure("invalid_input", 400, err.Error())
		}
		for _, test := range c.PrivateCases {
			if err := problems.ValidateProblemCase(f.Problem, test, true); err != nil {
				return f, failure("invalid_input", 400, fmt.Sprintf("Private test: %v", err))
			}
		}
	}

	f.Problem.Languages = []problems.LanguageImplementation{}
	for _, lang := range []string{"python", "java", "typescript", "ocaml"} {
		r, _ := execution.LanguageRuntime(lang)
		starter := c.StarterSource
		if lang != q.Language {
			var err error
			if f.Problem.Odyssey != nil {
				starter, err = interviewStageStarter(f.Problem.Odyssey.Levels[0].Methods, lang)
			} else {
				starter, err = interviewStarter(f.Problem.Signature, lang)
			}
			if err != nil {
				return f, failure("invalid_input", 400, err.Error())
			}
		}
		if len(starter) > interviews.MaxSourceBytes {
			return f, failure("invalid_input", 400, "Generated starter exceeds source limit")
		}
		f.Problem.Languages = append(f.Problem.Languages, problems.LanguageImplementation{Language: lang, StarterSource: starter, RuntimeRevision: r.Revision, HarnessRevision: r.Harness})
	}
	return f, nil
}

func interviewProgress(ctx context.Context, tx pgx.Tx, v interviewRecord) (int, bool, error) {
	level := 1
	completed := false
	err := tx.QueryRow(ctx, `SELECT level,completed FROM odyssey_progress WHERE scope_id=$1 AND problem_version_id=$2`, v.snapshot.QuestionEpoch, v.fixture.Problem.ID).Scan(&level, &completed)
	if err == pgx.ErrNoRows {
		err = nil
	}
	return level, completed, err
}

func requireInterviewOdyssey(ctx context.Context, tx pgx.Tx, host string, f problems.Fixture) error {
	if f.Problem.Odyssey == nil {
		return nil
	}
	caps, err := capabilities(ctx, tx, host)
	if err != nil {
		return err
	}
	if !caps.Odyssey {
		return failure("entitlement_required", 403, "Host Odyssey access required")
	}
	return nil
}
