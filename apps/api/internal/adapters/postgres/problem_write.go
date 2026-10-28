package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// Insert a version and all primary content atomically; seed replay is a no-op.
func insertProblemVersion(ctx context.Context, tx pgx.Tx, f problems.Fixture) (bool, error) {
	raw, err := json.Marshal(f)
	if err != nil {
		return false, err
	}
	var publicCases, stageCases []byte
	safe, lossless, err := caseStorageJSON(raw, false)
	if err != nil {
		return false, err
	}
	if lossless != nil {
		projection := problems.Fixture{}
		projection.Problem.Examples = f.Problem.Examples
		if f.Problem.Odyssey != nil && len(f.Problem.Odyssey.Levels) > 0 {
			projection.Problem.Odyssey = &problems.Odyssey{Levels: []problems.OdysseyLevel{{Examples: f.Problem.Odyssey.Levels[0].Examples}}}
		}
		if f.Problem.Odyssey != nil {
			allStages := problems.Fixture{}
			allStages.Problem.Odyssey = &problems.Odyssey{Levels: make([]problems.OdysseyLevel, len(f.Problem.Odyssey.Levels))}
			for i, level := range f.Problem.Odyssey.Levels {
				allStages.Problem.Odyssey.Levels[i].Examples = level.Examples
			}
			stageRaw, e := json.Marshal(allStages)
			if e != nil {
				return false, e
			}
			_, stageCases, e = caseStorageJSON(stageRaw, false)
			if e != nil {
				return false, e
			}
		}
		publicRaw, err := json.Marshal(projection)
		if err != nil {
			return false, err
		}
		_, publicCases, err = caseStorageJSON(publicRaw, false)
		if err != nil {
			return false, err
		}
		if err = json.Unmarshal(safe, &f); err != nil {
			return false, err
		}
	}
	public, err := json.Marshal(f.Problem)
	if err != nil {
		return false, err
	}
	hidden, err := json.Marshal(f.HiddenCases)
	if err != nil {
		return false, err
	}
	odysseyCases, err := json.Marshal(f.OdysseyHiddenCases)
	if err != nil {
		return false, err
	}
	var problemID string
	if err = tx.QueryRow(ctx, `INSERT INTO problems(slug) VALUES($1) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id`, f.Problem.Slug).Scan(&problemID); err != nil {
		return false, err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_fixture,lossless_public,lossless_stages)
 SELECT $1,$2,$3::text::integer,doc->>'title',doc->>'difficulty',doc->>'statementMarkdown',doc->'signature',COALESCE(doc->'constraints','[]'),doc->'limits',$5,doc->'sql',doc->'odyssey',$6,$7,$8
 FROM (SELECT $4::jsonb AS doc) input ON CONFLICT(id) DO NOTHING RETURNING id`, f.Problem.ID, problemID, f.Problem.Version, public, f.Attribution, lossless, publicCases, stageCases).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source)
 VALUES($1,CASE WHEN $2::jsonb->'sql' IS NOT NULL THEN 'postgresql' ELSE 'python' END,$2::jsonb->>'starterSource',$2::jsonb->>'runtimeRevision',$3,$4)`, id, public, f.HarnessRevision, f.ReferenceSource)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO problem_examples(version_id,ordinal,args,expected,explanation,calls)
 SELECT $1,ordinality-1,value->'args',value->'expected',COALESCE(value->>'explanation',''),COALESCE(value->'calls','[]') FROM jsonb_array_elements($2::jsonb->'examples') WITH ORDINALITY`, id, public)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO problem_test_cases(version_id,ordinal,args,expected,calls)
 SELECT $1,ordinality-1,value->'args',value->'expected',COALESCE(value->'calls','[]') FROM jsonb_array_elements(CASE WHEN jsonb_typeof($2::jsonb)='array' THEN $2::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY`, id, hidden)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO problem_odyssey_cases(version_id,level,ordinal,case_data)
 SELECT $1,stage.ordinality-1,c.ordinality-1,c.value
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof($2::jsonb)='array' THEN $2::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY stage(value,ordinality),
 LATERAL jsonb_array_elements(stage.value) WITH ORDINALITY c(value,ordinality)`, id, odysseyCases)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO problem_tags(version_id,tag,ordinal) SELECT $1,value,ordinality-1 FROM jsonb_array_elements_text($2::jsonb->'tags') WITH ORDINALITY`, id, public)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE problems SET current_version_id=$2 WHERE id=$1 AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<$3::text::integer)`, problemID, id, f.Problem.Version)
	return true, err
}
