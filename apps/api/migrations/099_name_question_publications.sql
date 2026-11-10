-- Rename stable publication references in place. UUIDs and foreign keys are preserved.
ALTER TABLE matches RENAME COLUMN problem_version_id TO publication_id;
ALTER TABLE matches RENAME COLUMN selected_problem_version_id TO selected_publication_id;
ALTER TABLE odyssey_progress RENAME COLUMN problem_version_id TO publication_id;
ALTER TABLE problem_examples RENAME COLUMN version_id TO publication_id;
ALTER TABLE problem_odyssey_cases RENAME COLUMN version_id TO publication_id;
ALTER TABLE problem_solution_approaches RENAME COLUMN version_id TO publication_id;
ALTER TABLE problem_solutions RENAME COLUMN version_id TO publication_id;
ALTER TABLE problem_tags RENAME COLUMN version_id TO publication_id;
ALTER TABLE problem_test_cases RENAME COLUMN version_id TO publication_id;
ALTER TABLE problems RENAME COLUMN current_version_id TO current_publication_id;
ALTER TABLE question_drafts RENAME COLUMN edit_version_id TO edit_publication_id;
ALTER TABLE question_drafts RENAME COLUMN published_version_id TO published_publication_id;
ALTER TABLE question_exposure RENAME COLUMN version_id TO publication_id;
ALTER TABLE question_learning_events RENAME COLUMN version_id TO publication_id;
ALTER TABLE question_learning_observations RENAME COLUMN version_id TO publication_id;
ALTER TABLE recommendation_impressions RENAME COLUMN version_id TO publication_id;
ALTER TABLE runner_job_inputs RENAME COLUMN version_id TO publication_id;
ALTER TABLE runner_version_input_cases RENAME COLUMN version_id TO publication_id;
ALTER TABLE runner_version_inputs RENAME COLUMN version_id TO publication_id;
ALTER TABLE workspaces RENAME COLUMN problem_version_id TO publication_id;
ALTER TABLE problem_versions RENAME TO question_publications;
ALTER TABLE runner_version_inputs RENAME TO runner_publication_inputs;
ALTER TABLE runner_version_input_cases RENAME TO runner_publication_input_cases;

ALTER TABLE matches RENAME CONSTRAINT matches_problem_version_id_fkey TO matches_publication_id_fkey;
ALTER TABLE matches RENAME CONSTRAINT matches_selected_problem_version_id_fkey TO matches_selected_publication_id_fkey;
ALTER TABLE problem_examples RENAME CONSTRAINT problem_examples_version_id_fkey TO problem_examples_publication_id_fkey;
ALTER TABLE problem_odyssey_cases RENAME CONSTRAINT problem_odyssey_cases_version_id_fkey TO problem_odyssey_cases_publication_id_fkey;
ALTER TABLE problem_solution_approaches RENAME CONSTRAINT problem_solution_approaches_version_id_fkey TO problem_solution_approaches_publication_id_fkey;
ALTER TABLE problem_solution_approaches RENAME CONSTRAINT problem_solution_approaches_version_id_ordinal_key TO problem_solution_approaches_publication_id_ordinal_key;
ALTER TABLE problem_tags RENAME CONSTRAINT problem_tags_version_id_fkey TO problem_tags_publication_id_fkey;
ALTER TABLE problem_tags RENAME CONSTRAINT problem_tags_version_id_ordinal_key TO problem_tags_publication_id_ordinal_key;
ALTER TABLE problem_test_cases RENAME CONSTRAINT problem_test_cases_version_id_fkey TO problem_test_cases_publication_id_fkey;
ALTER TABLE question_publications RENAME CONSTRAINT problem_version_identity TO publication_identity;
ALTER TABLE question_publications RENAME CONSTRAINT problem_versions_difficulty_check TO question_publications_difficulty_check;
ALTER TABLE question_publications RENAME CONSTRAINT problem_versions_pkey TO question_publications_pkey;
ALTER TABLE question_publications RENAME CONSTRAINT problem_versions_problem_id_fkey TO question_publications_problem_id_fkey;
ALTER TABLE question_drafts RENAME CONSTRAINT question_drafts_edit_version_fkey TO question_drafts_edit_publication_fkey;
ALTER TABLE question_drafts RENAME CONSTRAINT question_drafts_published_version_id_fkey TO question_drafts_published_publication_id_fkey;
ALTER TABLE question_exposure RENAME CONSTRAINT question_exposure_version_id_fkey TO question_exposure_publication_id_fkey;
ALTER TABLE question_learning_events RENAME CONSTRAINT question_learning_events_version_id_fkey TO question_learning_events_publication_id_fkey;
ALTER TABLE recommendation_impressions RENAME CONSTRAINT recommendation_impressions_owner_id_version_id_variant_mode_key TO recommendation_impressions_publication_variant_key;
ALTER TABLE recommendation_impressions RENAME CONSTRAINT recommendation_impressions_version_id_fkey TO recommendation_impressions_publication_id_fkey;
ALTER TABLE runner_job_inputs RENAME CONSTRAINT runner_job_inputs_version_id_fkey TO runner_job_inputs_publication_id_fkey;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_blob_hash_fkey TO runner_publication_input_cases_blob_hash_fkey;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_channel_check TO runner_publication_input_cases_channel_check;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_ordinal_check TO runner_publication_input_cases_ordinal_check;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_pkey TO runner_publication_input_cases_pkey;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_stage_check TO runner_publication_input_cases_stage_check;
ALTER TABLE runner_publication_input_cases RENAME CONSTRAINT runner_version_input_cases_version_id_fkey TO runner_publication_input_cases_publication_id_fkey;
ALTER TABLE runner_publication_inputs RENAME CONSTRAINT runner_version_inputs_fixture_hash_check TO runner_publication_inputs_fixture_hash_check;
ALTER TABLE runner_publication_inputs RENAME CONSTRAINT runner_version_inputs_metadata_hash_fkey TO runner_publication_inputs_metadata_hash_fkey;
ALTER TABLE runner_publication_inputs RENAME CONSTRAINT runner_version_inputs_pkey TO runner_publication_inputs_pkey;
ALTER TABLE runner_publication_inputs RENAME CONSTRAINT runner_version_inputs_version_id_fkey TO runner_publication_inputs_publication_id_fkey;
ALTER TABLE workspaces RENAME CONSTRAINT workspace_problem_version_fkey TO workspace_publication_fkey;
ALTER INDEX question_drafts_edit_version RENAME TO question_drafts_edit_publication;
ALTER INDEX question_drafts_published_version RENAME TO question_drafts_published_publication;
ALTER INDEX runner_version_input_cases_blob_hash_idx RENAME TO runner_publication_input_cases_blob_hash_idx;
ALTER INDEX runner_version_inputs_metadata_hash_idx RENAME TO runner_publication_inputs_metadata_hash_idx;
ALTER TRIGGER guard_question_version_insert ON question_publications RENAME TO guard_publication_insert;
ALTER TRIGGER immutable_problem_version ON question_publications RENAME TO immutable_publication;
ALTER TRIGGER runner_version_input_cases_guard ON runner_publication_input_cases RENAME TO runner_publication_input_cases_guard;
ALTER TRIGGER runner_version_input_delete_guard ON runner_publication_inputs RENAME TO runner_publication_input_delete_guard;
ALTER TRIGGER runner_version_inputs_guard ON runner_publication_inputs RENAME TO runner_publication_inputs_guard;

CREATE OR REPLACE FUNCTION public.attribute_recommendation_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.context='practice' THEN
  UPDATE recommendation_impressions SET
   first_outcome_at=COALESCE(first_outcome_at,NEW.observed_at),
   solved_at=CASE WHEN NEW.accepted THEN COALESCE(solved_at,NEW.observed_at) ELSE solved_at END
  WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND publication_id=NEW.publication_id AND started_at<=NEW.attempted_at
      AND started_at>=NEW.attempted_at-interval '2 hours'
    ORDER BY started_at DESC,id LIMIT 1);
  -- The first independent return in the measurement window is the delayed outcome.
  IF NOT NEW.assisted THEN
   UPDATE recommendation_impressions SET followup_solved=NEW.accepted
   WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND publication_id=NEW.publication_id
      AND solved_at BETWEEN NEW.attempted_at-interval '14 days' AND NEW.attempted_at-interval '2 days'
    ORDER BY solved_at DESC,id LIMIT 1)
    AND followup_solved IS NULL;
  END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.attribute_recommendation_start()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.kind='solo' THEN
  UPDATE recommendation_impressions SET started_at=clock_timestamp()
  WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND publication_id=NEW.publication_id
      AND viewed_at IS NOT NULL AND dismissed_at IS NULL
      AND served_at>=statement_timestamp()-interval '2 hours'
    ORDER BY served_at DESC,id LIMIT 1)
    AND started_at IS NULL;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_question_recommendation_data()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF current_setting('quorem.question_replacement',true) IS DISTINCT FROM OLD.id::text THEN
  DELETE FROM recommendation_impressions WHERE publication_id=OLD.id;
  DELETE FROM question_learning_events WHERE publication_id=OLD.id;
  DELETE FROM question_exposure WHERE publication_id=OLD.id;
 END IF;
 RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_lossless_case_claim()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
    AND current_setting('quorem.lossless_case_claim', true) IS DISTINCT FROM 'v1'
    AND EXISTS (
      SELECT 1 FROM submissions s
      LEFT JOIN workspaces w ON w.id=s.workspace_id
      LEFT JOIN question_publications v ON v.id=w.publication_id
      LEFT JOIN interview_execution ie ON ie.submission_id=s.id
      LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id
      WHERE s.id=NEW.submission_id AND (s.lossless_cases IS NOT NULL OR v.lossless_fixture IS NOT NULL OR q.lossless_fixture IS NOT NULL)
    ) THEN
   RAISE EXCEPTION 'lossless case-capable judge required';
 END IF;
 RETURN NEW;
END $function$;

ALTER FUNCTION guard_question_version_insert() RENAME TO guard_publication_insert;
CREATE OR REPLACE FUNCTION public.guard_publication_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 PERFORM 1 FROM problems WHERE id=NEW.problem_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM question_publications WHERE problem_id=NEW.problem_id AND sealed)
   AND NOT (
     current_setting('quorem.question_replacement',true) IS NOT DISTINCT FROM NEW.id::text
     AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM NEW.id::text
   ) THEN
  RAISE EXCEPTION 'Question already has a published identity' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_sealed_problem_child()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE closed boolean; identical boolean; target uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN target:=OLD.publication_id; ELSE target:=NEW.publication_id; END IF;
 -- Serialize registration against sealing; no child can slip past a concurrent seal.
 SELECT sealed INTO closed FROM question_publications WHERE id=target FOR SHARE;
 IF COALESCE(closed,false) THEN
  IF TG_OP='INSERT' THEN
   -- BEFORE INSERT also runs for ON CONFLICT; permit exact seed replay only.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I t WHERE t.publication_id=$2 AND to_jsonb(t)=$1)',TG_TABLE_SCHEMA,TG_TABLE_NAME)
    INTO identical USING to_jsonb(NEW),NEW.publication_id;
   IF identical THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.publication_id IS DISTINCT FROM NEW.publication_id THEN
  SELECT sealed INTO closed FROM question_publications WHERE id=OLD.publication_id FOR SHARE;
  IF closed THEN RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_workspace_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF (NEW.owner_id,NEW.publication_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
    IS DISTINCT FROM (OLD.owner_id,OLD.publication_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    AND NOT (
      NEW.publication_id IS NULL AND OLD.publication_id IS NOT NULL
      AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM OLD.publication_id::text
      AND (NEW.owner_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
        IS NOT DISTINCT FROM (OLD.owner_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    ) THEN
  RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.immutable_problem_content()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='question_publications' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash']::text[]
  THEN RAISE EXCEPTION 'Question seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $function$;

CREATE OR REPLACE FUNCTION public.observe_question_result()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
 question record;
 verdict text := NEW.result->>'verdict';
BEGIN
 IF NEW.state<>'completed' OR OLD.state='completed' OR NEW.kind<>'submit'
  OR NEW.custom_run OR NEW.interview_id IS NOT NULL OR verdict IS NULL
  OR verdict NOT IN ('accepted','wrong_answer','time_limit','runtime_error','memory_limit') THEN
  RETURN NEW;
 END IF;
 SELECT v.id,v.difficulty INTO question FROM workspaces w JOIN question_publications v ON v.id=w.publication_id
 WHERE w.id=NEW.workspace_id AND w.kind IN ('solo','match')
 AND (NEW.odyssey_level IS NULL OR NEW.odyssey_level=jsonb_array_length(v.odyssey->'levels'));
 IF question.id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO question_learning_events(submission_id,owner_id,publication_id,difficulty,tags,accepted,context,attempted_at)
 VALUES(NEW.id,NEW.owner_id,question.id,question.difficulty,
  ARRAY(SELECT tag FROM problem_tags WHERE publication_id=question.id ORDER BY ordinal),verdict='accepted',
  CASE WHEN NEW.match_id IS NOT NULL THEN 'match' ELSE 'practice' END,NEW.admitted_at)
 ON CONFLICT DO NOTHING;
 INSERT INTO question_exposure(owner_id,publication_id,last_seen_at) VALUES(NEW.owner_id,question.id,clock_timestamp())
 ON CONFLICT(owner_id,publication_id) DO UPDATE SET last_seen_at=GREATEST(question_exposure.last_seen_at,EXCLUDED.last_seen_at);
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.observe_question_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.kind IN ('solo','match') AND NEW.publication_id IS NOT NULL THEN
  INSERT INTO question_exposure(owner_id,publication_id,last_seen_at)
  VALUES(NEW.owner_id,NEW.publication_id,clock_timestamp())
  ON CONFLICT(owner_id,publication_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.retain_practice_feedback()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.workspace_id IS NULL OR NEW.match_id IS NOT NULL OR NEW.custom_run THEN
  RETURN NEW;
 END IF;
 IF EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND kind='solo') AND NEW.state='completed' AND NEW.kind='submit' AND
    COALESCE(NEW.result,OLD.result)->>'verdict'='accepted' AND NEW.odyssey_level IS NULL THEN
  INSERT INTO practice_solves(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
 END IF;
 IF OLD.state='completed' AND OLD.result IS NOT NULL AND NEW.result IS NULL
    AND OLD.odyssey_level IS NOT NULL THEN
  INSERT INTO practice_case_feedback(workspace_id,case_index,admitted_at,submission_id,status_json)
  SELECT DISTINCT ON(c.case_index) OLD.workspace_id,c.case_index,OLD.admitted_at,OLD.id,c.status_json
  FROM submission_public_case_statuses c
  JOIN workspaces w ON w.id=OLD.workspace_id
  LEFT JOIN odyssey_progress p ON p.scope_id=w.id AND p.publication_id=w.publication_id
  WHERE c.submission_id=OLD.id
    AND c.channel=CASE WHEN OLD.kind='run' THEN 'public' ELSE 'sample' END
    AND OLD.admitted_at>=COALESCE(p.reset_at,'-infinity'::timestamptz)
  ORDER BY c.case_index,c.ordinal DESC
  ON CONFLICT(workspace_id,case_index) DO UPDATE
  SET admitted_at=EXCLUDED.admitted_at, submission_id=EXCLUDED.submission_id,
      status_json=EXCLUDED.status_json
  WHERE (practice_case_feedback.admitted_at,practice_case_feedback.submission_id)
        < (EXCLUDED.admitted_at,EXCLUDED.submission_id);
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.runner_input_index_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE parent_sealed boolean;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'runner input case references are immutable'; END IF;
 IF TG_TABLE_NAME='runner_publication_input_cases' THEN
  SELECT sealed INTO parent_sealed FROM runner_publication_inputs WHERE publication_id=COALESCE(NEW.publication_id,OLD.publication_id);
 ELSIF TG_TABLE_NAME='runner_snapshot_input_cases' THEN
  SELECT sealed INTO parent_sealed FROM runner_snapshot_inputs WHERE session_id=COALESCE(NEW.session_id,OLD.session_id) AND fixture_id=COALESCE(NEW.fixture_id,OLD.fixture_id);
 ELSE
  SELECT sealed INTO parent_sealed FROM runner_job_inputs WHERE job_id=COALESCE(NEW.job_id,OLD.job_id);
 END IF;
 IF TG_OP='DELETE' THEN
  IF parent_sealed IS NOT NULL THEN RAISE EXCEPTION 'runner input case references are immutable'; END IF;
  RETURN OLD;
 END IF;
 IF parent_sealed IS DISTINCT FROM false THEN RAISE EXCEPTION 'runner input index is sealed'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.runner_input_manifest_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE n integer; v integer; actual_metadata bytea; actual_source bytea; revision text; harness text; actual_publication uuid; actual_session uuid; actual_fixture bytea;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.sealed THEN RAISE EXCEPTION 'runner input manifests must be built before sealing'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.sealed OR NOT NEW.sealed OR (to_jsonb(OLD)-'sealed') IS DISTINCT FROM (to_jsonb(NEW)-'sealed') THEN
  RAISE EXCEPTION 'runner input manifests are immutable';
 END IF;
 IF TG_TABLE_NAME='runner_publication_inputs' THEN
  IF EXISTS(SELECT 1 FROM runner_publication_input_cases WHERE publication_id=NEW.publication_id GROUP BY channel,stage HAVING min(ordinal)<>0 OR max(ordinal)+1<>count(*)) THEN RAISE EXCEPTION 'invalid fixture index'; END IF;
 ELSIF TG_TABLE_NAME='runner_snapshot_inputs' THEN
  IF EXISTS(SELECT 1 FROM runner_snapshot_input_cases WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id GROUP BY channel,stage HAVING min(ordinal)<>0 OR max(ordinal)+1<>count(*)) THEN RAISE EXCEPTION 'invalid fixture index'; END IF;
 ELSE
  SELECT count(*),COALESCE(max(ordinal),-1) INTO n,v FROM runner_job_input_cases WHERE job_id=NEW.job_id;
  IF n<>NEW.case_count+(CASE WHEN NEW.submit_cases_are_samples THEN 0 ELSE NEW.sample_count END) OR v<>n-1 THEN RAISE EXCEPTION 'invalid job index'; END IF;
  IF (SELECT count(*) FROM runner_job_input_cases WHERE job_id=NEW.job_id AND channel='sample')<>(CASE WHEN NEW.submit_cases_are_samples THEN 0 ELSE NEW.sample_count END) THEN RAISE EXCEPTION 'invalid sample count'; END IF;
  IF NEW.publication_id IS NOT NULL THEN SELECT metadata_hash INTO actual_metadata FROM runner_publication_inputs WHERE publication_id=NEW.publication_id AND sealed;
  ELSE SELECT metadata_hash INTO actual_metadata FROM runner_snapshot_inputs WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id AND sealed; END IF;
  SELECT sha256(convert_to(s.source,'UTF8')),j.runtime_revision,j.harness_revision,w.publication_id,ie.session_id,ie.fixture_id INTO actual_source,revision,harness,actual_publication,actual_session,actual_fixture FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id WHERE j.id=NEW.job_id;
  IF actual_metadata IS DISTINCT FROM NEW.metadata_hash OR actual_source IS DISTINCT FROM NEW.source_hash OR revision IS DISTINCT FROM NEW.runtime_revision OR harness IS DISTINCT FROM NEW.harness_revision OR actual_publication IS DISTINCT FROM NEW.publication_id OR actual_session IS DISTINCT FROM NEW.session_id OR actual_fixture IS DISTINCT FROM NEW.fixture_id OR NEW.private_details IS DISTINCT FROM (actual_session IS NOT NULL) THEN RAISE EXCEPTION 'invalid job input binding'; END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.runner_input_root_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_TABLE_NAME='runner_job_inputs' THEN
  IF EXISTS(SELECT 1 FROM execution_jobs WHERE id=OLD.job_id) THEN RAISE EXCEPTION 'runner job input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_publication_inputs' THEN
  IF EXISTS(SELECT 1 FROM question_publications WHERE id=OLD.publication_id) THEN RAISE EXCEPTION 'runner publication input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_snapshot_inputs' THEN
  IF EXISTS(SELECT 1 FROM interview_question_snapshots WHERE session_id=OLD.session_id AND id=OLD.fixture_id) THEN RAISE EXCEPTION 'runner snapshot input is retained'; END IF;
 END IF;
 RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.snapshot_practice_assistance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.workspace_id IS NOT NULL THEN
  NEW.practice_assisted := EXISTS (
   SELECT 1 FROM workspaces w JOIN question_exposure x ON x.publication_id=w.publication_id
   WHERE w.id=NEW.workspace_id AND x.owner_id=NEW.owner_id
     AND x.assisted_at BETWEEN NEW.admitted_at-interval '1 day' AND NEW.admitted_at
  );
 END IF;
 RETURN NEW;
END $function$;
