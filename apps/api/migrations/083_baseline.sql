-- Fresh public schema through the archived migration history.

SET LOCAL check_function_bodies = false;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE FUNCTION public.cleanup_terminal_checkpoint() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.finished AND NOT OLD.finished THEN
  DELETE FROM execution_checkpoints WHERE job_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.cleanup_terminal_completion_staging() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.finished AND NOT OLD.finished THEN
  DELETE FROM execution_completion_staging WHERE job_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.clear_finished_match_reconciliation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state IN ('completed', 'cancelled') THEN
    DELETE FROM match_reconciliation_pending WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.clear_interview_result_payload() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.result IS NOT NULL AND NEW.result IS NULL THEN
  UPDATE interview_execution SET private_results=NULL,private_results_payload=NULL WHERE submission_id=NEW.id AND (private_results IS NOT NULL OR private_results_payload IS NOT NULL);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.clear_legacy_private_result_payload() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.private_results IS NULL OR current_setting('quorem.lossless_result_write',true) IS DISTINCT FROM 'v1' THEN
  NEW.private_results_payload := NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.clear_normalized_submission_results() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.result IS NOT NULL AND NEW.result IS NULL THEN
  DELETE FROM submission_public_result_cases WHERE submission_id=NEW.id;
  DELETE FROM submission_result_headers WHERE submission_id=NEW.id;
  DELETE FROM submission_result_header_fields WHERE submission_id=NEW.id;
  DELETE FROM interview_private_result_cases WHERE submission_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.clear_submission_result_payload() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.result IS NULL OR current_setting('quorem.lossless_result_write',true) IS DISTINCT FROM 'v1' THEN
  NEW.result_payload := NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.execution_verified_case_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'verified cases are immutable'; END IF;
 IF EXISTS(SELECT 1 FROM execution_jobs WHERE id=OLD.job_id) THEN RAISE EXCEPTION 'verified cases are immutable'; END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION public.guard_checkpoint_claim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF ((NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)
     OR (NEW.finished AND NOT OLD.finished AND NEW.attempt_id IS NULL AND OLD.attempt_id IS NOT NULL AND OLD.attempts>=3
         AND EXISTS(SELECT 1 FROM submissions WHERE id=NEW.submission_id AND NOT cancel_requested)))
    AND EXISTS(SELECT 1 FROM execution_checkpoints WHERE job_id=NEW.id)
    AND current_setting('quorem.checkpoint_claim',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'checkpoint-capable judge required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_execution_attempt_inventory() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 RAISE EXCEPTION 'attempt inventory is immutable' USING ERRCODE='55000';
END $$;

CREATE FUNCTION public.guard_expired_attempt_reclaim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN
  NEW.sandbox_scope := NULLIF(current_setting('quorem.sandbox_scope', true), '');
 END IF;
 IF OLD.attempt_id IS NOT NULL AND OLD.lease_until < clock_timestamp()
    AND ((NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)
         OR (NEW.finished AND NOT OLD.finished AND NEW.attempt_id IS NULL))
    AND current_setting('quorem.reaped_attempt', true) IS DISTINCT FROM OLD.attempt_id::text THEN
  RAISE EXCEPTION 'expired attempt teardown required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_lossless_case_claim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
    AND current_setting('quorem.lossless_case_claim', true) IS DISTINCT FROM 'v1'
    AND EXISTS (
      SELECT 1 FROM submissions s
      LEFT JOIN workspaces w ON w.id=s.workspace_id
      LEFT JOIN problem_versions v ON v.id=w.problem_version_id
      LEFT JOIN interview_execution ie ON ie.submission_id=s.id
      LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id
      WHERE s.id=NEW.submission_id AND (s.lossless_cases IS NOT NULL OR v.lossless_fixture IS NOT NULL OR q.lossless_fixture IS NOT NULL)
    ) THEN
   RAISE EXCEPTION 'lossless case-capable judge required';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_lossless_case_cleanup() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.lossless_cases IS NOT NULL AND NEW.cases IS DISTINCT FROM OLD.cases
    AND NEW.lossless_cases IS NOT DISTINCT FROM OLD.lossless_cases THEN
   IF NEW.cases = '[]'::jsonb AND NEW.state NOT IN ('queued','running') THEN
     NEW.lossless_cases := NULL;
   ELSE
     RAISE EXCEPTION 'lossless case-capable writer required';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_lossless_draft_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.lossless_content IS NOT NULL AND current_setting('quorem.lossless_case_write',true) IS DISTINCT FROM 'v1' THEN
   RAISE EXCEPTION 'lossless case-capable authoring required';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_lossless_interview_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.lossless_question IS NOT NULL AND current_setting('quorem.lossless_case_write',true) IS DISTINCT FROM 'v1' THEN
   RAISE EXCEPTION 'lossless case-capable interview writer required';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_sealed_problem_child() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE closed boolean; identical boolean; target uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN target:=OLD.version_id; ELSE target:=NEW.version_id; END IF;
 -- Serialize registration against sealing; no child can slip past a concurrent seal.
 SELECT sealed INTO closed FROM problem_versions WHERE id=target FOR SHARE;
 IF COALESCE(closed,false) THEN
  IF TG_OP='INSERT' THEN
   -- BEFORE INSERT also runs for ON CONFLICT; permit exact seed replay only.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I t WHERE t.version_id=$2 AND to_jsonb(t)=$1)',TG_TABLE_SCHEMA,TG_TABLE_NAME)
    INTO identical USING to_jsonb(NEW),NEW.version_id;
   IF identical THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Sealed problem content is immutable; create a new version' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.version_id IS DISTINCT FROM NEW.version_id THEN
  SELECT sealed INTO closed FROM problem_versions WHERE id=OLD.version_id FOR SHARE;
  IF closed THEN RAISE EXCEPTION 'Sealed problem content is immutable; create a new version' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $_$;

CREATE FUNCTION public.guard_sealed_problem_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.sealed AND current_setting('quorem.question_mutation',true) IS DISTINCT FROM OLD.id::text THEN
  RAISE EXCEPTION 'Use the question authoring operation to delete a published version' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION public.guard_stage_genesis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 RAISE EXCEPTION 'stage genesis is immutable' USING ERRCODE='55000';
END $$;

CREATE FUNCTION public.guard_team_workspace_access() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE current_workspace uuid;
BEGIN
  -- Deferred checks validate the final row, not an intermediate workspace replaced in this transaction.
  IF TG_TABLE_NAME='submissions' THEN
    SELECT workspace_id INTO current_workspace FROM submissions WHERE id=NEW.id;
  ELSE
    SELECT workspace_id INTO current_workspace FROM match_participants WHERE match_id=NEW.match_id AND owner_id=NEW.owner_id;
  END IF;
  IF NOT FOUND OR current_workspace IS DISTINCT FROM NEW.workspace_id THEN RETURN NEW; END IF;
  IF NEW.workspace_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (
      (w.team IS NULL AND w.owner_id=NEW.owner_id) OR
      (w.team IS NOT NULL AND w.match_id=NEW.match_id AND EXISTS (
        SELECT 1 FROM match_participants p WHERE p.match_id=w.match_id AND p.owner_id=NEW.owner_id AND p.team=w.team
      ))
    )
  ) THEN RAISE EXCEPTION 'Workspace must belong to actor or admitted team' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_terminal_result_rows() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE current_state text; result_retained boolean; target uuid;
BEGIN
 target := CASE WHEN TG_OP='DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
 SELECT state,result IS NOT NULL INTO current_state,result_retained FROM submissions WHERE id=target FOR UPDATE;
 IF current_state IN ('completed','failed','cancelled') AND NOT
    ((TG_OP='INSERT' AND result_retained AND current_setting('quorem.result_backfill',true) IS NOT DISTINCT FROM 'v1') OR
     (TG_OP='DELETE' AND TG_TABLE_NAME='interview_private_result_cases' AND result_retained AND current_setting('quorem.legacy_private_rebuild',true) IS NOT DISTINCT FROM 'v1' AND NOT EXISTS(SELECT 1 FROM submission_result_headers WHERE submission_id=target)) OR
     (TG_OP='DELETE' AND NOT result_retained)) THEN
  RAISE EXCEPTION 'terminal result rows are immutable' USING ERRCODE='55000';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION public.guard_workspace_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF (NEW.owner_id,NEW.problem_version_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
    IS DISTINCT FROM (OLD.owner_id,OLD.problem_version_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    AND NOT (
      NEW.problem_version_id IS NULL AND OLD.problem_version_id IS NOT NULL
      AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM OLD.problem_version_id::text
      AND (NEW.owner_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
        IS NOT DISTINCT FROM (OLD.owner_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    ) THEN
  RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_workspace_match_context() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE workspace_match uuid;
BEGIN
 IF NEW.workspace_id IS NOT NULL THEN
  SELECT match_id INTO workspace_match FROM workspaces WHERE id=NEW.workspace_id;
  IF workspace_match IS DISTINCT FROM NEW.match_id THEN
   RAISE EXCEPTION 'Workspace match context differs from its consumer' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.immutable_access_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Access audit is append only'; END $$;

CREATE FUNCTION public.immutable_interview_execution_context() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['private_results','private_results_payload']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['private_results','private_results_payload']) THEN
  RAISE EXCEPTION 'Interview execution context is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.immutable_interview_question_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Interview question snapshots are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.immutable_problem_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','version','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash']::text[]
  THEN RAISE EXCEPTION 'Problem version seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.version,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.version,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $$;

CREATE FUNCTION public.interview_active_runner_input_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE current_epoch uuid; input_sealed boolean;
BEGIN
 SELECT question_epoch INTO current_epoch FROM interviews WHERE id=NEW.session_id FOR SHARE;
 SELECT sealed INTO input_sealed FROM runner_snapshot_inputs WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id;
 IF current_epoch IS DISTINCT FROM NEW.question_epoch OR input_sealed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'active runner input is stale or unsealed';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.interview_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE session uuid; kind text;
BEGIN
 kind := 'interview.session';
 IF TG_TABLE_NAME='interviews' THEN
  session := NEW.id;
  IF NEW.document_epoch=OLD.document_epoch AND NEW.document_version<>OLD.document_version THEN kind := 'interview.document'; END IF;
 ELSIF TG_TABLE_NAME='submissions' THEN
  kind := 'interview.result';
  SELECT session_id INTO session FROM interview_execution WHERE submission_id=NEW.id;
 ELSE
  IF TG_TABLE_NAME='interview_presence' THEN kind := 'interview.presence'; END IF;
  IF TG_TABLE_NAME='interview_execution' THEN kind := 'interview.result'; END IF;
  IF TG_OP='DELETE' THEN session := OLD.session_id; ELSE session := NEW.session_id; END IF;
 END IF;
 IF session IS NOT NULL THEN
  INSERT INTO interview_outbox(session_id,event_type) SELECT session,kind WHERE EXISTS(SELECT 1 FROM interviews WHERE id=session);
  PERFORM pg_notify('quorem_interview_outbox','');
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.interview_clear_stale_runner_input() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.question_epoch IS DISTINCT FROM NEW.question_epoch THEN
  DELETE FROM interview_active_runner_inputs WHERE session_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.interview_public_signature(value jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'description',value->'description','returns',value->'returns','outputOrder',value->'outputOrder',
  'className',value->'className','methodName',value->'methodName','returnType',value->'returnType',
  'parameters',(SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',p->'name','type',p->'type','description',p->'description','input',CASE WHEN p->'input' IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('preset',p->'input'->'preset','placeholder',p->'input'->'placeholder','rows',p->'input'->'rows')) END)) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value->'parameters')='array' THEN value->'parameters' ELSE '[]'::jsonb END) WITH ORDINALITY t(p,n)),
  'throws',(SELECT jsonb_agg(jsonb_build_object('type',t->'type','description',t->'description') ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value->'throws')='array' THEN value->'throws' ELSE '[]'::jsonb END) WITH ORDINALITY v(t,n))
 ));
$$;

CREATE FUNCTION public.meter_guest_execution() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE elapsed integer; terminal_state text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM guest_execution_usage WHERE submission_id=OLD.submission_id) THEN RETURN NEW; END IF;
 IF OLD.attempt_id IS NOT NULL AND OLD.attempt_started_at IS NOT NULL AND (NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR (NEW.finished AND NOT OLD.finished)) THEN
  elapsed:=GREATEST(0,CEIL(EXTRACT(EPOCH FROM(clock_timestamp()-OLD.attempt_started_at)))::integer);
  INSERT INTO execution_attempt_usage(attempt_id,submission_id,seconds) VALUES(OLD.attempt_id,OLD.submission_id,elapsed) ON CONFLICT DO NOTHING;
 END IF;
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN NEW.attempt_started_at:=CASE WHEN NEW.attempt_id IS NULL THEN NULL ELSE clock_timestamp() END; END IF;
 IF NEW.finished AND NOT OLD.finished THEN
  SELECT state INTO terminal_state FROM submissions WHERE id=NEW.submission_id;
  UPDATE guest_execution_usage SET charged_seconds=CASE WHEN terminal_state='completed' THEN COALESCE((SELECT sum(seconds) FROM execution_attempt_usage WHERE submission_id=NEW.submission_id),0) ELSE 0 END,settled_at=clock_timestamp() WHERE submission_id=NEW.submission_id AND settled_at IS NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.notify_execution_cancellation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.cancel_requested AND NOT OLD.cancel_requested THEN
    PERFORM pg_notify('quorem_execution_cancel', NEW.id::text);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.notify_execution_jobs() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('quorem_execution_jobs', '');
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.notify_match_deadline_schedule() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('quorem_match_deadlines', '');
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.notify_match_outbox() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('quorem_match_outbox','');
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.queue_match_reconciliation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.match_id IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO match_reconciliation_pending(match_id) VALUES (NEW.match_id)
    ON CONFLICT(match_id) DO UPDATE SET generation=match_reconciliation_pending.generation+1;
    PERFORM pg_notify('quorem_match_deadlines', '');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.queue_submission_notice() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.result IS DISTINCT FROM OLD.result OR NEW.cancel_requested IS DISTINCT FROM OLD.cancel_requested THEN
    INSERT INTO submission_outbox(submission_id) VALUES (NEW.id);
    PERFORM pg_notify('quorem_submission_outbox', '');
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.quorem_suite_digest(target_job uuid) RETURNS bytea
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE state bytea := decode('d4449379235da810eea3292dffe8855373685d5d58e5dcc8070ed931bddae7c8','hex'); item record;
BEGIN
 FOR item IN SELECT ordinal,channel,blob_hash FROM runner_job_input_cases WHERE job_id=target_job ORDER BY ordinal LOOP
  state := sha256(state || int4send(item.ordinal) || convert_to(item.channel,'UTF8') || decode('00','hex') || item.blob_hash);
 END LOOP;
 RETURN state;
END $$;

CREATE FUNCTION public.record_execution_attempt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id THEN
  IF NEW.attempt_id IS NOT NULL AND NEW.sandbox_scope IS DISTINCT FROM OLD.sandbox_scope THEN
   RAISE EXCEPTION 'attempt scope is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.attempt_id IS NOT NULL THEN
  INSERT INTO public.execution_attempt_inventory(attempt_id,job_id,sandbox_scope)
  VALUES(NEW.attempt_id,NEW.id,NEW.sandbox_scope);
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.retain_practice_feedback() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
  LEFT JOIN odyssey_progress p ON p.scope_id=w.id AND p.problem_version_id=w.problem_version_id
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
END $$;

CREATE FUNCTION public.runner_input_blob_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 RAISE EXCEPTION 'runner input blobs are immutable';
END $$;

CREATE FUNCTION public.runner_input_index_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE parent_sealed boolean;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'runner input case references are immutable'; END IF;
 IF TG_TABLE_NAME='runner_version_input_cases' THEN
  SELECT sealed INTO parent_sealed FROM runner_version_inputs WHERE version_id=COALESCE(NEW.version_id,OLD.version_id);
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
END $$;

CREATE FUNCTION public.runner_input_manifest_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE n integer; v integer; actual_metadata bytea; actual_source bytea; revision text; harness text; actual_version uuid; actual_session uuid; actual_fixture bytea;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.sealed THEN RAISE EXCEPTION 'runner input manifests must be built before sealing'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.sealed OR NOT NEW.sealed OR (to_jsonb(OLD)-'sealed') IS DISTINCT FROM (to_jsonb(NEW)-'sealed') THEN
  RAISE EXCEPTION 'runner input manifests are immutable';
 END IF;
 IF TG_TABLE_NAME='runner_version_inputs' THEN
  IF EXISTS(SELECT 1 FROM runner_version_input_cases WHERE version_id=NEW.version_id GROUP BY channel,stage HAVING min(ordinal)<>0 OR max(ordinal)+1<>count(*)) THEN RAISE EXCEPTION 'invalid fixture index'; END IF;
 ELSIF TG_TABLE_NAME='runner_snapshot_inputs' THEN
  IF EXISTS(SELECT 1 FROM runner_snapshot_input_cases WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id GROUP BY channel,stage HAVING min(ordinal)<>0 OR max(ordinal)+1<>count(*)) THEN RAISE EXCEPTION 'invalid fixture index'; END IF;
 ELSE
  SELECT count(*),COALESCE(max(ordinal),-1) INTO n,v FROM runner_job_input_cases WHERE job_id=NEW.job_id;
  IF n<>NEW.case_count+(CASE WHEN NEW.submit_cases_are_samples THEN 0 ELSE NEW.sample_count END) OR v<>n-1 THEN RAISE EXCEPTION 'invalid job index'; END IF;
  IF (SELECT count(*) FROM runner_job_input_cases WHERE job_id=NEW.job_id AND channel='sample')<>(CASE WHEN NEW.submit_cases_are_samples THEN 0 ELSE NEW.sample_count END) THEN RAISE EXCEPTION 'invalid sample count'; END IF;
  IF NEW.version_id IS NOT NULL THEN SELECT metadata_hash INTO actual_metadata FROM runner_version_inputs WHERE version_id=NEW.version_id AND sealed;
  ELSE SELECT metadata_hash INTO actual_metadata FROM runner_snapshot_inputs WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id AND sealed; END IF;
  SELECT sha256(convert_to(s.source,'UTF8')),j.runtime_revision,j.harness_revision,w.problem_version_id,ie.session_id,ie.fixture_id INTO actual_source,revision,harness,actual_version,actual_session,actual_fixture FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id WHERE j.id=NEW.job_id;
  IF actual_metadata IS DISTINCT FROM NEW.metadata_hash OR actual_source IS DISTINCT FROM NEW.source_hash OR revision IS DISTINCT FROM NEW.runtime_revision OR harness IS DISTINCT FROM NEW.harness_revision OR actual_version IS DISTINCT FROM NEW.version_id OR actual_session IS DISTINCT FROM NEW.session_id OR actual_fixture IS DISTINCT FROM NEW.fixture_id OR NEW.private_details IS DISTINCT FROM (actual_session IS NOT NULL) THEN RAISE EXCEPTION 'invalid job input binding'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.runner_input_root_delete_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_TABLE_NAME='runner_job_inputs' THEN
  IF EXISTS(SELECT 1 FROM execution_jobs WHERE id=OLD.job_id) THEN RAISE EXCEPTION 'runner job input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_version_inputs' THEN
  IF EXISTS(SELECT 1 FROM problem_versions WHERE id=OLD.version_id) THEN RAISE EXCEPTION 'runner version input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_snapshot_inputs' THEN
  IF EXISTS(SELECT 1 FROM interview_question_snapshots WHERE session_id=OLD.session_id AND id=OLD.fixture_id) THEN RAISE EXCEPTION 'runner snapshot input is retained'; END IF;
 END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION public.runner_job_input_digest_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=NEW.job_id AND sealed)
     OR NEW.digest IS DISTINCT FROM quorem_suite_digest(NEW.job_id) THEN
   RAISE EXCEPTION 'invalid sealed suite digest';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=OLD.job_id) THEN
  RAISE EXCEPTION 'sealed suite digest is immutable';
 END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION public.runner_manifest_claim_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id AND NEW.attempt_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=NEW.id)
    AND current_setting('quorem.runner_input_protocol',true) IS DISTINCT FROM 'manifest-v1' THEN
  RAISE EXCEPTION 'runner input protocol required';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.seal_runner_job_input_digest() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 INSERT INTO runner_job_input_digests(job_id,digest) VALUES(NEW.job_id,quorem_suite_digest(NEW.job_id));
 RETURN NEW;
END $$;

CREATE TABLE public.access_audit (
    operation_id text NOT NULL,
    actor text NOT NULL,
    user_id text NOT NULL,
    action text NOT NULL,
    scope text NOT NULL,
    reason text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE public.cancellation_idempotency (
    owner_id text NOT NULL,
    key text NOT NULL,
    submission_id uuid NOT NULL,
    response jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.companies (
    id bigint NOT NULL,
    name text NOT NULL,
    CONSTRAINT companies_name_check CHECK (((name = btrim(name)) AND ((length(name) >= 1) AND (length(name) <= 80)) AND (POSITION((','::text) IN (name)) = 0)))
);

ALTER TABLE public.companies ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.deadline_prearms (
    id uuid NOT NULL,
    purpose text NOT NULL,
    shard integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    committed_at timestamp with time zone,
    CONSTRAINT deadline_prearms_purpose_check CHECK ((purpose = ANY (ARRAY['deadline'::text, 'execution'::text]))),
    CONSTRAINT deadline_prearms_shard_check CHECK (((shard >= 0) AND (shard < 256)))
);

CREATE TABLE public.entitlement_grants (
    id uuid NOT NULL,
    user_id text NOT NULL,
    feature text NOT NULL,
    source text NOT NULL,
    source_ref text NOT NULL,
    valid_from timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    actor text NOT NULL,
    reason text NOT NULL,
    CONSTRAINT entitlement_grants_feature_check CHECK ((feature = ANY (ARRAY['internal'::text, 'matches.host_guests'::text, 'intelligence.hosted'::text, 'experimental'::text, 'interviews.host'::text, 'questions.custom'::text]))),
    CONSTRAINT entitlement_grants_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'internal'::text, 'subscription'::text])))
);

CREATE TABLE public.execution_attempt_inventory (
    attempt_id uuid NOT NULL,
    job_id uuid NOT NULL,
    sandbox_scope text NOT NULL,
    claimed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT execution_attempt_inventory_sandbox_scope_check CHECK (((octet_length(sandbox_scope) >= 1) AND (octet_length(sandbox_scope) <= 256)))
);

CREATE TABLE public.execution_attempt_usage (
    attempt_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    seconds integer NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT execution_attempt_usage_seconds_check CHECK ((seconds >= 0))
);

CREATE TABLE public.execution_checkpoint_cases (
    job_id uuid NOT NULL,
    ordinal integer NOT NULL,
    frame bytea NOT NULL,
    CONSTRAINT execution_checkpoint_cases_ordinal_check CHECK (((ordinal >= 0) AND (ordinal < 2147483647)))
);

CREATE TABLE public.execution_checkpoints (
    job_id uuid NOT NULL,
    last_attempt_id uuid,
    next_ordinal integer DEFAULT 0 NOT NULL,
    artifact jsonb,
    compilation_nanos bigint DEFAULT 0 NOT NULL,
    fatal bytea,
    definite_failures integer DEFAULT 0 NOT NULL,
    CONSTRAINT execution_checkpoints_compilation_nanos_check CHECK (((compilation_nanos >= 0) AND (compilation_nanos <= '120000000000'::bigint))),
    CONSTRAINT execution_checkpoints_definite_failures_check CHECK ((definite_failures >= 0)),
    CONSTRAINT execution_checkpoints_next_ordinal_check CHECK ((next_ordinal >= 0))
);

CREATE TABLE public.execution_completion_field_chunks (
    job_id uuid NOT NULL,
    channel text NOT NULL,
    ordinal integer NOT NULL,
    field text NOT NULL,
    chunk_ordinal integer NOT NULL,
    chunk_data bytea NOT NULL,
    chunk_hash bytea NOT NULL,
    CONSTRAINT execution_completion_field_chunks_channel_check CHECK ((channel = ANY (ARRAY['public'::text, 'sample'::text, 'private'::text, 'header'::text]))),
    CONSTRAINT execution_completion_field_chunks_chunk_data_check CHECK ((octet_length(chunk_data) <= 65536)),
    CONSTRAINT execution_completion_field_chunks_chunk_hash_check CHECK ((octet_length(chunk_hash) = 32)),
    CONSTRAINT execution_completion_field_chunks_chunk_ordinal_check CHECK ((chunk_ordinal >= 0)),
    CONSTRAINT execution_completion_field_chunks_field_check CHECK ((field = ANY (ARRAY['actual'::text, 'expected'::text, 'stdout'::text, 'stderr'::text, 'diagnostics'::text, 'sqlTypes'::text]))),
    CONSTRAINT execution_completion_field_chunks_ordinal_check CHECK (((ordinal >= 0) AND (ordinal < 2147483647)))
);

CREATE TABLE public.execution_completion_frames (
    job_id uuid NOT NULL,
    channel text NOT NULL,
    ordinal integer NOT NULL,
    status text NOT NULL,
    frame_data bytea NOT NULL,
    frame_hash bytea NOT NULL,
    CONSTRAINT execution_completion_frames_channel_check CHECK ((channel = ANY (ARRAY['public'::text, 'sample'::text, 'private'::text]))),
    CONSTRAINT execution_completion_frames_frame_hash_check CHECK ((octet_length(frame_hash) = 32)),
    CONSTRAINT execution_completion_frames_ordinal_check CHECK (((ordinal >= 0) AND (ordinal < 2147483647)))
);

CREATE TABLE public.execution_completion_header_fields (
    job_id uuid NOT NULL,
    field text NOT NULL,
    field_data bytea NOT NULL,
    field_hash bytea NOT NULL,
    CONSTRAINT execution_completion_header_fields_field_check CHECK ((field = ANY (ARRAY['diagnostics'::text, 'verdict'::text, 'infrastructureError'::text, 'hiddenCases'::text]))),
    CONSTRAINT execution_completion_header_fields_field_hash_check CHECK ((octet_length(field_hash) = 32))
);

CREATE TABLE public.execution_completion_receipts (
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    sandbox_scope text NOT NULL,
    outcome text NOT NULL,
    CONSTRAINT execution_completion_receipts_outcome_check CHECK ((outcome = ANY (ARRAY['completed'::text, 'cancelled'::text, 'failed'::text, 'requeued'::text])))
);

CREATE TABLE public.execution_completion_staging (
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    sandbox_scope text NOT NULL,
    header_data bytea NOT NULL,
    header_hash bytea NOT NULL,
    eof boolean DEFAULT false NOT NULL,
    CONSTRAINT execution_completion_staging_header_hash_check CHECK ((octet_length(header_hash) = 32))
);

CREATE TABLE public.execution_dispatch_intents (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    available_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    delivered_at timestamp with time zone,
    dispatch_token uuid,
    dispatch_until timestamp with time zone
);

CREATE TABLE public.execution_idempotency (
    owner_id text NOT NULL,
    key text NOT NULL,
    body_hash text NOT NULL,
    submission_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.execution_jobs (
    id uuid NOT NULL,
    submission_id uuid NOT NULL,
    attempt_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    lease_until timestamp with time zone,
    finished boolean DEFAULT false NOT NULL,
    language text DEFAULT 'python'::text NOT NULL,
    runtime_revision text DEFAULT 'python-3.12-v1'::text NOT NULL,
    harness_revision text DEFAULT 'quorem-harness-v2'::text NOT NULL,
    attempt_started_at timestamp with time zone,
    sandbox_scope text
);

CREATE TABLE public.execution_verification_challenges (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    sandbox_scope text NOT NULL,
    job_data text NOT NULL,
    result_channel text NOT NULL,
    result_ordinal integer NOT NULL,
    ordinal integer NOT NULL,
    channel text NOT NULL,
    frame_hash bytea NOT NULL,
    raw_status text NOT NULL,
    CONSTRAINT execution_verification_challenges_channel_check CHECK ((channel = ANY (ARRAY['public'::text, 'sample'::text, 'private'::text]))),
    CONSTRAINT execution_verification_challenges_frame_hash_check CHECK ((octet_length(frame_hash) = 32)),
    CONSTRAINT execution_verification_challenges_ordinal_check CHECK (((ordinal >= 0) AND (ordinal <= 2147483646))),
    CONSTRAINT execution_verification_challenges_result_channel_check CHECK ((result_channel = ANY (ARRAY['public'::text, 'sample'::text, 'private'::text]))),
    CONSTRAINT execution_verification_challenges_result_ordinal_check CHECK (((result_ordinal >= 0) AND (result_ordinal <= 2147483646)))
);

CREATE TABLE public.execution_verification_output_chunks (
    challenge_id uuid NOT NULL,
    field text NOT NULL,
    ordinal integer NOT NULL,
    data bytea NOT NULL,
    hash bytea NOT NULL,
    CONSTRAINT execution_verification_output_chunks_data_check CHECK (((octet_length(data) >= 1) AND (octet_length(data) <= 65536))),
    CONSTRAINT execution_verification_output_chunks_field_check CHECK ((field = ANY (ARRAY['actual'::text, 'expected'::text]))),
    CONSTRAINT execution_verification_output_chunks_hash_check CHECK ((hash = sha256(data))),
    CONSTRAINT execution_verification_output_chunks_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.execution_verified_cases (
    job_id uuid NOT NULL,
    ordinal integer NOT NULL,
    attempt_id uuid NOT NULL,
    sandbox_scope text NOT NULL,
    challenge_id uuid NOT NULL,
    binding bytea NOT NULL,
    frame_hash bytea NOT NULL,
    actual_hash bytea,
    expected_hash bytea,
    type_mismatch boolean NOT NULL,
    status text NOT NULL,
    CONSTRAINT execution_verified_cases_actual_hash_check CHECK (((actual_hash IS NULL) OR (octet_length(actual_hash) = 32))),
    CONSTRAINT execution_verified_cases_binding_check CHECK ((octet_length(binding) = 32)),
    CONSTRAINT execution_verified_cases_expected_hash_check CHECK (((expected_hash IS NULL) OR (octet_length(expected_hash) = 32))),
    CONSTRAINT execution_verified_cases_frame_hash_check CHECK ((octet_length(frame_hash) = 32)),
    CONSTRAINT execution_verified_cases_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'wrong_answer'::text, 'executed'::text, 'syntax_error'::text, 'runtime_error'::text, 'time_limit'::text, 'memory_limit'::text, 'output_limit'::text, 'invalid_output'::text])))
);

CREATE TABLE public.guest_execution_usage (
    submission_id uuid NOT NULL,
    match_id uuid NOT NULL,
    sponsor_id text NOT NULL,
    reserved_seconds integer DEFAULT 60 NOT NULL,
    charged_seconds integer,
    settled_at timestamp with time zone,
    admitted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT guest_execution_usage_charged_seconds_check CHECK ((charged_seconds >= 0)),
    CONSTRAINT guest_execution_usage_reserved_seconds_check CHECK ((reserved_seconds = 60))
);

CREATE TABLE public.guest_request_buckets (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    used integer NOT NULL
);

CREATE TABLE public.guest_sessions (
    token_hash text NOT NULL,
    owner_id text NOT NULL,
    match_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    party_id uuid,
    CONSTRAINT guest_sessions_scope_check CHECK (((match_id IS NOT NULL) <> (party_id IS NOT NULL)))
);

CREATE TABLE public.guest_sponsor_locks (
    user_id text NOT NULL
);

CREATE TABLE public.identity_bindings (
    issuer text NOT NULL,
    subject text NOT NULL,
    user_id text NOT NULL
);

CREATE TABLE public.interview_active_runner_inputs (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    fixture_id bytea NOT NULL
);

CREATE TABLE public.interview_case_visibility (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    case_id text NOT NULL
);

CREATE TABLE public.interview_execution (
    submission_id uuid NOT NULL,
    session_id uuid NOT NULL,
    document_version bigint NOT NULL,
    document_epoch uuid NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    progress_scope uuid,
    question_epoch uuid NOT NULL,
    private_results jsonb,
    fixture_id bytea NOT NULL,
    private_results_payload bytea
);

CREATE VIEW public.interview_execution_public WITH (security_barrier='true') AS
 SELECT submission_id,
    session_id,
    question_epoch,
    fixture_id,
    level,
        CASE
            WHEN (jsonb_typeof(private_results) = 'array'::text) THEN jsonb_array_length(private_results)
            ELSE 0
        END AS result_count,
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('index', (r.v -> 'index'::text), 'status', (r.v -> 'status'::text)) ORDER BY r.n), '[]'::jsonb) AS "coalesce"
           FROM jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof(interview_execution.private_results) = 'array'::text) THEN interview_execution.private_results
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY r(v, n)) AS private_statuses
   FROM public.interview_execution;

CREATE TABLE public.interview_guest_sessions (
    token_hash text NOT NULL,
    owner_id text NOT NULL,
    session_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '24:00:00'::interval) NOT NULL,
    revoked_at timestamp with time zone
);

CREATE TABLE public.interview_language_drafts (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    language text NOT NULL,
    source text NOT NULL
);

CREATE TABLE public.interview_members (
    session_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT interview_members_role_check CHECK ((role = ANY (ARRAY['interviewer'::text, 'interviewee'::text])))
);

CREATE TABLE public.interview_operations (
    owner_id text NOT NULL,
    key text NOT NULL,
    fingerprint text NOT NULL,
    session_id uuid NOT NULL,
    response jsonb
);

CREATE TABLE public.interview_outbox (
    sequence bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_at timestamp with time zone,
    dispatch_token uuid,
    dispatch_until timestamp with time zone
);

CREATE SEQUENCE public.interview_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.interview_outbox_sequence_seq OWNED BY public.interview_outbox.sequence;

CREATE TABLE public.interview_presence (
    session_id uuid NOT NULL,
    user_id text NOT NULL,
    client_id text NOT NULL,
    epoch uuid NOT NULL,
    version bigint NOT NULL,
    anchor integer NOT NULL,
    head integer NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE public.interview_private_case_statuses (
    submission_id uuid NOT NULL,
    ordinal integer NOT NULL,
    case_id text NOT NULL,
    status_json bytea NOT NULL,
    status_hash bytea NOT NULL,
    CONSTRAINT interview_private_case_statuses_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT interview_private_case_statuses_status_hash_check CHECK ((status_hash = sha256(status_json))),
    CONSTRAINT interview_private_case_statuses_status_json_check CHECK ((json_typeof((convert_from(status_json, 'UTF8'::name))::json) = 'string'::text))
);

CREATE TABLE public.interview_private_result_cases (
    submission_id uuid NOT NULL,
    ordinal integer NOT NULL,
    result_data bytea NOT NULL,
    CONSTRAINT interview_private_result_cases_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.interview_private_status_headers (
    submission_id uuid NOT NULL,
    status_count integer NOT NULL,
    CONSTRAINT interview_private_status_headers_status_count_check CHECK ((status_count >= 0))
);

CREATE TABLE public.interview_public_examples (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    level integer NOT NULL,
    examples bytea NOT NULL,
    CONSTRAINT interview_public_examples_level_check CHECK ((level >= 0))
);

CREATE TABLE public.interview_question_private_cases (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    case_id text NOT NULL,
    ordinal integer NOT NULL,
    case_data bytea NOT NULL,
    CONSTRAINT interview_question_private_cases_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.interviews (
    id uuid NOT NULL,
    host_id text NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    question jsonb NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    document_version bigint DEFAULT 0 NOT NULL,
    document_epoch uuid NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    invite_hash text NOT NULL,
    invite_token text NOT NULL,
    guest_joins integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    question_epoch uuid NOT NULL,
    interviewer_invite_token text NOT NULL,
    interviewer_invite_hash text NOT NULL,
    deleted_at timestamp with time zone,
    monitoring jsonb DEFAULT '{}'::jsonb NOT NULL,
    admission_locked boolean DEFAULT false NOT NULL,
    lossless_question bytea,
    CONSTRAINT interviews_deleted_closed CHECK (((deleted_at IS NULL) OR (state = 'closed'::text))),
    CONSTRAINT interviews_monitoring_check CHECK ((jsonb_typeof(monitoring) = 'object'::text)),
    CONSTRAINT interviews_state_check CHECK ((state = ANY (ARRAY['active'::text, 'closed'::text])))
);

CREATE VIEW public.interview_question_public WITH (security_barrier='true') AS
 SELECT i.id AS session_id,
    i.question_epoch,
    jsonb_strip_nulls(jsonb_build_object('hints', (i.question -> 'hints'::text), 'problem', jsonb_strip_nulls(jsonb_build_object('id', (source.p -> 'id'::text), 'slug', (source.p -> 'slug'::text), 'version', (source.p -> 'version'::text), 'title', (source.p -> 'title'::text), 'difficulty', (source.p -> 'difficulty'::text), 'tags', (source.p -> 'tags'::text), 'companies', (source.p -> 'companies'::text), 'leetcodeId', (source.p -> 'leetcodeId'::text), 'statementMarkdown', (source.p -> 'statementMarkdown'::text), 'signature', public.interview_public_signature((source.p -> 'signature'::text)), 'constraints', (source.p -> 'constraints'::text), 'limits', (source.p -> 'limits'::text), 'sql', (source.p -> 'sql'::text), 'starterSource', (source.p -> 'starterSource'::text), 'runtimeRevision', (source.p -> 'runtimeRevision'::text), 'languages', ( SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('language', (langs.l -> 'language'::text), 'starterSource', (langs.l -> 'starterSource'::text), 'runtimeRevision', (langs.l -> 'runtimeRevision'::text), 'harnessRevision', (langs.l -> 'harnessRevision'::text))) ORDER BY langs.n), '[]'::jsonb) AS "coalesce"
           FROM jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof((source.p -> 'languages'::text)) = 'array'::text) THEN (source.p -> 'languages'::text)
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY langs(l, n)), 'odyssey',
        CASE
            WHEN (jsonb_typeof(((source.p -> 'odyssey'::text) -> 'levels'::text)) = 'array'::text) THEN jsonb_build_object('levels', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('title', (ls.stage -> 'title'::text), 'statementMarkdown', (ls.stage -> 'statementMarkdown'::text), 'methods', ( SELECT COALESCE(jsonb_agg(public.interview_public_signature(ms.method) ORDER BY ms.mn), '[]'::jsonb) AS "coalesce"
                       FROM jsonb_array_elements(
                            CASE
                                WHEN (jsonb_typeof((ls.stage -> 'methods'::text)) = 'array'::text) THEN (ls.stage -> 'methods'::text)
                                ELSE '[]'::jsonb
                            END) WITH ORDINALITY ms(method, mn))) ORDER BY ls.n), '[]'::jsonb) AS "coalesce"
               FROM jsonb_array_elements(((source.p -> 'odyssey'::text) -> 'levels'::text)) WITH ORDINALITY ls(stage, n)))
            ELSE NULL::jsonb
        END)))) AS metadata,
        CASE
            WHEN (jsonb_typeof(((source.p -> 'odyssey'::text) -> 'levels'::text)) = 'array'::text) THEN ARRAY( SELECT ((('level:'::text || (stages.n)::text) || ':case:'::text) || (idx.idx)::text)
               FROM (jsonb_array_elements(
                    CASE
                        WHEN (jsonb_typeof((i.question -> 'odysseyHiddenCases'::text)) = 'array'::text) THEN (i.question -> 'odysseyHiddenCases'::text)
                        ELSE '[]'::jsonb
                    END) WITH ORDINALITY stages(suite, n)
                 CROSS JOIN LATERAL generate_series(0, (jsonb_array_length(
                    CASE
                        WHEN (jsonb_typeof(stages.suite) = 'array'::text) THEN stages.suite
                        ELSE '[]'::jsonb
                    END) - 1)) idx(idx))
              ORDER BY stages.n, idx.idx)
            ELSE ARRAY( SELECT ('hidden:'::text || (idx.idx)::text)
               FROM generate_series(0, (jsonb_array_length(
                    CASE
                        WHEN (jsonb_typeof((i.question -> 'hiddenCases'::text)) = 'array'::text) THEN (i.question -> 'hiddenCases'::text)
                        ELSE '[]'::jsonb
                    END) - 1)) idx(idx)
              ORDER BY idx.idx)
        END AS private_ids
   FROM (public.interviews i
     CROSS JOIN LATERAL ( SELECT (i.question -> 'problem'::text) AS p) source);

CREATE TABLE public.interview_question_snapshots (
    session_id uuid NOT NULL,
    id bytea NOT NULL,
    fixture jsonb NOT NULL,
    lossless_fixture bytea,
    CONSTRAINT interview_question_snapshots_check CHECK ((id = sha256(convert_to((fixture)::text, 'UTF8'::name)))),
    CONSTRAINT lossless_fixture_hash CHECK (((lossless_fixture IS NULL) OR (NOT ((fixture ->> '_lossless_sha256'::text) IS DISTINCT FROM encode(sha256(lossless_fixture), 'hex'::text)))))
);

CREATE TABLE public.interview_rule_events (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT interview_rule_events_kind_check CHECK ((kind = ANY (ARRAY['paste'::text, 'focus'::text])))
);

CREATE VIEW public.interview_snapshot_public WITH (security_barrier='true') AS
 SELECT session_id,
    id AS fixture_id,
        CASE
            WHEN (jsonb_typeof((((fixture -> 'problem'::text) -> 'odyssey'::text) -> 'levels'::text)) = 'array'::text) THEN jsonb_array_length((((fixture -> 'problem'::text) -> 'odyssey'::text) -> 'levels'::text))
            ELSE 0
        END AS total_stages,
        CASE
            WHEN (jsonb_typeof((((fixture -> 'problem'::text) -> 'odyssey'::text) -> 'levels'::text)) = 'array'::text) THEN ARRAY( SELECT ((('level:'::text || (stages.n)::text) || ':case:'::text) || (idx.idx)::text)
               FROM (jsonb_array_elements(
                    CASE
                        WHEN (jsonb_typeof((q.fixture -> 'odysseyHiddenCases'::text)) = 'array'::text) THEN (q.fixture -> 'odysseyHiddenCases'::text)
                        ELSE '[]'::jsonb
                    END) WITH ORDINALITY stages(suite, n)
                 CROSS JOIN LATERAL generate_series(0, (jsonb_array_length(
                    CASE
                        WHEN (jsonb_typeof(stages.suite) = 'array'::text) THEN stages.suite
                        ELSE '[]'::jsonb
                    END) - 1)) idx(idx))
              ORDER BY stages.n, idx.idx)
            ELSE ARRAY( SELECT ('hidden:'::text || (idx.idx)::text)
               FROM generate_series(0, (jsonb_array_length(
                    CASE
                        WHEN (jsonb_typeof((q.fixture -> 'hiddenCases'::text)) = 'array'::text) THEN (q.fixture -> 'hiddenCases'::text)
                        ELSE '[]'::jsonb
                    END) - 1)) idx(idx)
              ORDER BY idx.idx)
        END AS private_ids,
    jsonb_array_length(
        CASE
            WHEN (jsonb_typeof(((fixture -> 'problem'::text) -> 'examples'::text)) = 'array'::text) THEN ((fixture -> 'problem'::text) -> 'examples'::text)
            ELSE '[]'::jsonb
        END) AS example_count
   FROM public.interview_question_snapshots q;

CREATE TABLE public.interview_snapshot_public_examples (
    session_id uuid NOT NULL,
    fixture_id bytea NOT NULL,
    level integer NOT NULL,
    examples bytea NOT NULL,
    CONSTRAINT interview_snapshot_public_examples_level_check CHECK ((level >= 0))
);

CREATE TABLE public.interview_updates (
    session_id uuid NOT NULL,
    epoch uuid NOT NULL,
    version bigint NOT NULL,
    client_id text NOT NULL,
    changes jsonb NOT NULL
);

CREATE TABLE public.maintenance_schedule (
    task text NOT NULL,
    next_run_at timestamp with time zone NOT NULL
);

CREATE TABLE public.match_idempotency (
    owner_id text NOT NULL,
    route text NOT NULL,
    key text NOT NULL,
    body_hash text NOT NULL,
    response jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.match_outbox (
    sequence bigint NOT NULL,
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    version bigint NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_at timestamp with time zone,
    dispatch_token uuid,
    dispatch_until timestamp with time zone,
    CONSTRAINT match_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['match.updated'::text, 'match.completed'::text])))
);

ALTER TABLE public.match_outbox ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.match_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.match_participants (
    match_id uuid NOT NULL,
    owner_id text NOT NULL,
    seat integer NOT NULL,
    ready boolean DEFAULT false NOT NULL,
    presence text DEFAULT 'offline'::text NOT NULL,
    workspace_id uuid,
    best_passed integer DEFAULT 0 NOT NULL,
    submission_state text,
    forfeited boolean DEFAULT false NOT NULL,
    last_rule_event_at timestamp with time zone,
    competitor_id text,
    eligible_finish_at timestamp with time zone,
    best_percentage double precision DEFAULT 0 NOT NULL,
    team smallint,
    CONSTRAINT match_participants_presence_check CHECK ((presence = ANY (ARRAY['online'::text, 'offline'::text]))),
    CONSTRAINT match_participants_seat_check CHECK (((seat >= 1) AND (seat <= 8))),
    CONSTRAINT match_participants_team_check CHECK (((team >= 1) AND (team <= 4)))
);

CREATE TABLE public.match_private_result_cases (
    submission_id uuid NOT NULL,
    ordinal integer NOT NULL,
    result_data bytea NOT NULL,
    CONSTRAINT match_private_result_cases_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.match_reconciliation_pending (
    match_id uuid NOT NULL,
    generation bigint DEFAULT 1 NOT NULL
);

CREATE TABLE public.match_reservations (
    owner_id text NOT NULL,
    match_id uuid NOT NULL
);

CREATE TABLE public.match_rule_events (
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    competitor_id text NOT NULL,
    action text DEFAULT 'announce'::text NOT NULL,
    seconds integer DEFAULT 0 NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    resource_key text,
    submission_id uuid,
    CONSTRAINT match_rule_events_kind_check CHECK ((kind = ANY (ARRAY['clipboard'::text, 'copy'::text, 'focus'::text, 'topics'::text, 'complexity'::text, 'hiddenCase'::text, 'submission'::text]))),
    CONSTRAINT match_rule_events_points_check CHECK ((points >= 0)),
    CONSTRAINT match_rule_events_seconds_check CHECK ((seconds >= 0))
);

CREATE TABLE public.match_teams (
    match_id uuid NOT NULL,
    team smallint NOT NULL,
    workspace_id uuid,
    source text DEFAULT ''::text NOT NULL,
    document_version bigint DEFAULT 0 NOT NULL,
    document_epoch uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT match_teams_document_version_check CHECK ((document_version >= 0)),
    CONSTRAINT match_teams_team_check CHECK (((team >= 1) AND (team <= 4)))
);

CREATE TABLE public.matches (
    id uuid NOT NULL,
    host_owner_id text NOT NULL,
    invite_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    duration_minutes integer NOT NULL,
    state text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    admission_sequence bigint DEFAULT 0 NOT NULL,
    problem_version_id uuid,
    started_at timestamp with time zone,
    deadline timestamp with time zone,
    finalizing_at timestamp with time zone,
    outcome jsonb,
    reconciled_at timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    mode text DEFAULT 'showdown'::text NOT NULL,
    difficulties text[] NOT NULL,
    selected_problem_version_id uuid,
    rules jsonb DEFAULT '{"copy": "off", "focus": "announce", "victory": "race", "clipboard": "announce", "assistance": {"topics": {"access": "penalty", "points": 3, "seconds": 30}, "complexity": {"access": "penalty", "points": 5, "seconds": 60}, "hiddenCase": {"access": "penalty", "points": 10, "seconds": 120}}, "submissions": {"points": 0, "seconds": 0, "cooldownSeconds": 10, "freeSubmissions": 3}, "settingsEditors": "host", "behavioralPoints": 2, "behavioralSeconds": 15, "focusFreeWarnings": 1, "focusGraceSeconds": 3}'::jsonb NOT NULL,
    access_mode text DEFAULT 'accounts_only'::text NOT NULL,
    guest_joins integer DEFAULT 0 NOT NULL,
    admission_locked boolean DEFAULT false NOT NULL,
    question_filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    party_id uuid,
    share_code_after_match boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    rule_deadline timestamp with time zone,
    faction_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT matches_access_mode_check CHECK ((access_mode = ANY (ARRAY['accounts_only'::text, 'guests_allowed'::text]))),
    CONSTRAINT matches_check CHECK ((((started_at IS NULL) AND (problem_version_id IS NULL)) OR ((started_at IS NOT NULL) AND ((problem_version_id IS NOT NULL) OR (state = ANY (ARRAY['completed'::text, 'cancelled'::text])))))),
    CONSTRAINT matches_check1 CHECK (((state = ANY (ARRAY['completed'::text, 'cancelled'::text])) = (outcome IS NOT NULL))),
    CONSTRAINT matches_difficulties_check CHECK (((cardinality(difficulties) BETWEEN 1 AND 3) AND (difficulties <@ ARRAY['easy'::text, 'medium'::text, 'hard'::text]) AND (array_position(difficulties, NULL::text) IS NULL))),
    CONSTRAINT matches_duration_minutes_check CHECK ((duration_minutes = ANY (ARRAY[15, 30, 45, 60]))),
    CONSTRAINT matches_mode_check CHECK ((mode = ANY (ARRAY['showdown'::text, 'free-for-all'::text, 'factions'::text]))),
    CONSTRAINT matches_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'ready'::text, 'active'::text, 'finalizing'::text, 'completed'::text, 'cancelled'::text])))
);

CREATE TABLE public.odyssey_progress (
    scope_id uuid NOT NULL,
    problem_version_id uuid NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    reset_at timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    CONSTRAINT odyssey_progress_level_check CHECK (((level >= 1) AND (level <= 8)))
);

CREATE TABLE public.parties (
    id uuid NOT NULL,
    host_owner_id text NOT NULL,
    invite_hash text NOT NULL,
    settings jsonb NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    current_match_id uuid,
    latest_match_id uuid,
    countdown_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    disbanded_at timestamp with time zone,
    guest_joins integer DEFAULT 0 NOT NULL,
    queue_error text,
    team_count smallint DEFAULT 2 NOT NULL,
    faction_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT parties_guest_joins_check CHECK ((guest_joins >= 0)),
    CONSTRAINT parties_team_count_check CHECK (((team_count >= 2) AND (team_count <= 4)))
);

CREATE TABLE public.party_members (
    party_id uuid NOT NULL,
    owner_id text NOT NULL,
    seat integer NOT NULL,
    ready boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    team smallint,
    CONSTRAINT party_members_seat_check CHECK (((seat >= 1) AND (seat <= 8))),
    CONSTRAINT party_members_team_check CHECK (((team >= 1) AND (team <= 4)))
);

CREATE TABLE public.platform_presence_leases (
    owner_id text NOT NULL,
    window_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.practice_case_feedback (
    workspace_id uuid NOT NULL,
    case_index integer NOT NULL,
    admitted_at timestamp with time zone NOT NULL,
    submission_id uuid NOT NULL,
    status_json bytea NOT NULL
);

CREATE TABLE public.practice_solves (
    workspace_id uuid NOT NULL
);

CREATE TABLE public.problem_companies (
    problem_id uuid NOT NULL,
    company_id bigint NOT NULL
);

CREATE TABLE public.problem_examples (
    version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    args jsonb NOT NULL,
    expected jsonb NOT NULL,
    explanation text DEFAULT ''::text NOT NULL,
    calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT problem_examples_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.problem_odyssey_cases (
    version_id uuid NOT NULL,
    level integer NOT NULL,
    ordinal integer NOT NULL,
    case_data jsonb NOT NULL,
    CONSTRAINT problem_odyssey_cases_level_check CHECK ((level >= 0)),
    CONSTRAINT problem_odyssey_cases_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.problem_solution_approaches (
    version_id uuid NOT NULL,
    id text NOT NULL,
    ordinal integer NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    is_canonical boolean DEFAULT false NOT NULL,
    default_language text,
    explanation_markdown text NOT NULL,
    time_complexity text NOT NULL,
    space_complexity text NOT NULL,
    complexity_notes text NOT NULL,
    CONSTRAINT problem_solution_approaches_default_language_check CHECK (((is_canonical AND (default_language IS NULL)) OR ((NOT is_canonical) AND (default_language IS NOT NULL) AND (default_language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text, 'postgresql'::text]))))),
    CONSTRAINT problem_solution_approaches_id_check CHECK (((id ~ '^[a-z][a-z0-9-]*$'::text) AND (length(id) <= 64))),
    CONSTRAINT problem_solution_approaches_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.problem_solutions (
    version_id uuid NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    approach_id text NOT NULL,
    CONSTRAINT problem_solutions_language_check CHECK ((language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text, 'postgresql'::text])))
);

CREATE TABLE public.problem_tags (
    version_id uuid NOT NULL,
    tag text NOT NULL,
    ordinal integer NOT NULL,
    CONSTRAINT problem_tags_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT problem_tags_tag_check CHECK ((length(tag) > 0))
);

CREATE TABLE public.problem_test_cases (
    version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    args jsonb NOT NULL,
    expected jsonb NOT NULL,
    calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT problem_test_cases_ordinal_check CHECK ((ordinal >= 0))
);

CREATE TABLE public.problem_versions (
    id uuid NOT NULL,
    version integer NOT NULL,
    problem_id uuid NOT NULL,
    title text NOT NULL,
    difficulty text NOT NULL,
    statement_markdown text NOT NULL,
    signature jsonb,
    constraints jsonb NOT NULL,
    limits jsonb NOT NULL,
    attribution text NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    sql_config jsonb,
    odyssey jsonb,
    lossless_fixture bytea,
    lossless_public bytea,
    lossless_stages bytea,
    fixture_identity_hash bytea,
    CONSTRAINT problem_fixture_identity_hash CHECK (((fixture_identity_hash IS NULL) OR (octet_length(fixture_identity_hash) = 32))),
    CONSTRAINT problem_signature_owner CHECK (((((sql_config IS NULL) OR (sql_config = 'null'::jsonb)) AND (odyssey IS NULL) AND (signature IS NOT NULL)) OR (((odyssey IS NOT NULL) OR ((sql_config IS NOT NULL) AND (sql_config <> 'null'::jsonb))) AND (signature IS NULL)))),
    CONSTRAINT problem_versions_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])))
);

CREATE TABLE public.problems (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    current_version_id uuid,
    owner_id text,
    leetcode_id integer,
    CONSTRAINT problems_leetcode_id_check CHECK ((leetcode_id > 0))
);

CREATE TABLE public.question_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    content jsonb NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_version_id uuid,
    owner_id text,
    lossless_content bytea,
    import_digest text,
    edit_version_id uuid,
    edit_base text,
    CONSTRAINT question_drafts_content_check CHECK (((jsonb_typeof(content) = 'object'::text) AND (octet_length((content)::text) <= 4194304))),
    CONSTRAINT question_drafts_revision_check CHECK ((revision > 0))
);

CREATE TABLE public.quota_overrides (
    user_id text NOT NULL,
    resource text NOT NULL,
    value integer NOT NULL,
    expires_at timestamp with time zone,
    actor text NOT NULL,
    reason text NOT NULL,
    CONSTRAINT quota_overrides_resource_check CHECK ((resource = ANY (ARRAY['guest_concurrency'::text, 'interview_concurrency'::text]))),
    CONSTRAINT quota_overrides_value_check CHECK (((value > 0) AND (value <= 600000)))
);

CREATE TABLE public.realtime_presence_leases (
    id uuid NOT NULL,
    topic text NOT NULL,
    subject text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT realtime_presence_leases_check CHECK (((length(topic) <= 128) AND (length(subject) <= 128)))
);

CREATE TABLE public.runner_input_blobs (
    hash bytea NOT NULL,
    data bytea NOT NULL,
    CONSTRAINT runner_input_blobs_hash_check CHECK (((octet_length(hash) = 32) AND (hash = sha256(data))))
);

CREATE TABLE public.runner_input_gc_state (
    id integer NOT NULL,
    cursor bytea,
    CONSTRAINT runner_input_gc_state_cursor_check CHECK (((cursor IS NULL) OR (octet_length(cursor) = 32))),
    CONSTRAINT runner_input_gc_state_id_check CHECK ((id = 1))
);

CREATE TABLE public.runner_job_input_cases (
    job_id uuid NOT NULL,
    ordinal integer NOT NULL,
    channel text NOT NULL,
    blob_hash bytea NOT NULL,
    CONSTRAINT runner_job_input_cases_channel_check CHECK ((channel = ANY (ARRAY['public'::text, 'sample'::text, 'private'::text]))),
    CONSTRAINT runner_job_input_cases_ordinal_check CHECK (((ordinal >= 0) AND (ordinal < 2147483647)))
);

CREATE TABLE public.runner_job_input_digests (
    job_id uuid NOT NULL,
    digest bytea NOT NULL,
    CONSTRAINT runner_job_input_digests_digest_check CHECK ((octet_length(digest) = 32))
);

CREATE TABLE public.runner_job_inputs (
    job_id uuid NOT NULL,
    version_id uuid,
    session_id uuid,
    fixture_id bytea,
    metadata_hash bytea NOT NULL,
    source_hash bytea NOT NULL,
    runtime_revision text NOT NULL,
    harness_revision text NOT NULL,
    case_count integer NOT NULL,
    sample_count integer NOT NULL,
    private_details boolean NOT NULL,
    submit_cases_are_samples boolean NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    CONSTRAINT runner_job_inputs_case_count_check CHECK ((case_count >= 0)),
    CONSTRAINT runner_job_inputs_check CHECK ((((case_count)::bigint +
CASE
    WHEN submit_cases_are_samples THEN 0
    ELSE sample_count
END) <= 2147483647)),
    CONSTRAINT runner_job_inputs_check1 CHECK (((NOT submit_cases_are_samples) OR (private_details AND (case_count = sample_count)))),
    CONSTRAINT runner_job_inputs_check2 CHECK ((((version_id IS NOT NULL) AND (session_id IS NULL) AND (fixture_id IS NULL)) OR ((version_id IS NULL) AND (session_id IS NOT NULL) AND (fixture_id IS NOT NULL)))),
    CONSTRAINT runner_job_inputs_sample_count_check CHECK ((sample_count >= 0)),
    CONSTRAINT runner_job_inputs_source_hash_check CHECK ((octet_length(source_hash) = 32))
);

CREATE TABLE public.runner_snapshot_input_cases (
    session_id uuid NOT NULL,
    fixture_id bytea NOT NULL,
    channel text NOT NULL,
    stage integer NOT NULL,
    ordinal integer NOT NULL,
    blob_hash bytea NOT NULL,
    CONSTRAINT runner_snapshot_input_cases_channel_check CHECK ((channel = ANY (ARRAY['example'::text, 'hidden'::text]))),
    CONSTRAINT runner_snapshot_input_cases_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT runner_snapshot_input_cases_stage_check CHECK ((stage >= 0))
);

CREATE TABLE public.runner_snapshot_inputs (
    session_id uuid NOT NULL,
    fixture_id bytea NOT NULL,
    metadata_hash bytea NOT NULL,
    fixture_hash bytea NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    CONSTRAINT runner_snapshot_inputs_fixture_hash_check CHECK ((octet_length(fixture_hash) = 32))
);

CREATE TABLE public.runner_version_input_cases (
    version_id uuid NOT NULL,
    channel text NOT NULL,
    stage integer NOT NULL,
    ordinal integer NOT NULL,
    blob_hash bytea NOT NULL,
    CONSTRAINT runner_version_input_cases_channel_check CHECK ((channel = ANY (ARRAY['example'::text, 'hidden'::text]))),
    CONSTRAINT runner_version_input_cases_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT runner_version_input_cases_stage_check CHECK ((stage >= 0))
);

CREATE TABLE public.runner_version_inputs (
    version_id uuid NOT NULL,
    metadata_hash bytea NOT NULL,
    fixture_hash bytea NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    CONSTRAINT runner_version_inputs_fixture_hash_check CHECK ((octet_length(fixture_hash) = 32))
);

CREATE TABLE public.stage_genesis (
    singleton boolean DEFAULT true NOT NULL,
    database_identity text NOT NULL,
    namespace text NOT NULL,
    scope text NOT NULL,
    initial_operation uuid NOT NULL,
    initial_release text NOT NULL,
    initial_bindings text NOT NULL,
    owner_key_sha256 text NOT NULL,
    genesis_envelope jsonb NOT NULL,
    migration_062_sha256 text NOT NULL,
    CONSTRAINT stage_genesis_bindings_check CHECK ((initial_bindings ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT stage_genesis_database_identity_check CHECK (((octet_length(database_identity) >= 1) AND (octet_length(database_identity) <= 512))),
    CONSTRAINT stage_genesis_migration_check CHECK ((migration_062_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT stage_genesis_namespace_check CHECK ((namespace ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT stage_genesis_operation_check CHECK (((initial_operation)::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'::text)),
    CONSTRAINT stage_genesis_owner_key_check CHECK ((owner_key_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT stage_genesis_release_check CHECK ((initial_release ~ '^[a-f0-9]{40}$'::text)),
    CONSTRAINT stage_genesis_scope_check CHECK ((scope ~ '^remote:[a-f0-9]{64}$'::text)),
    CONSTRAINT stage_genesis_singleton_check CHECK (singleton)
);

CREATE TABLE public.submission_outbox (
    sequence bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_at timestamp with time zone,
    dispatch_token uuid,
    dispatch_until timestamp with time zone
);

ALTER TABLE public.submission_outbox ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.submission_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.submission_public_case_statuses (
    submission_id uuid NOT NULL,
    channel text NOT NULL,
    ordinal integer NOT NULL,
    case_index integer NOT NULL,
    status_json bytea NOT NULL,
    status_hash bytea NOT NULL,
    CONSTRAINT submission_public_case_statuses_case_index_check CHECK ((case_index >= 0)),
    CONSTRAINT submission_public_case_statuses_status_hash_check CHECK ((status_hash = sha256(status_json))),
    CONSTRAINT submission_public_case_statuses_status_json_check CHECK ((json_typeof((convert_from(status_json, 'UTF8'::name))::json) = 'string'::text))
);

CREATE TABLE public.submission_public_result_cases (
    submission_id uuid NOT NULL,
    channel text NOT NULL,
    ordinal integer NOT NULL,
    result_data bytea NOT NULL,
    CONSTRAINT submission_public_result_cases_channel_check CHECK ((channel = ANY (ARRAY['public'::text, 'sample'::text]))),
    CONSTRAINT submission_public_result_cases_ordinal_check CHECK (((ordinal >= 0) AND (ordinal < 2147483647)))
);

CREATE TABLE public.submission_result_header_fields (
    submission_id uuid NOT NULL,
    field text NOT NULL,
    field_data bytea NOT NULL,
    CONSTRAINT submission_result_header_fields_field_check CHECK ((field = ANY (ARRAY['diagnostics'::text, 'verdict'::text, 'infrastructureError'::text, 'hiddenCases'::text])))
);

CREATE TABLE public.submission_result_headers (
    submission_id uuid NOT NULL,
    header_data bytea NOT NULL
);

CREATE TABLE public.submissions (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    workspace_id uuid,
    kind text NOT NULL,
    source text NOT NULL,
    source_hash text NOT NULL,
    state text NOT NULL,
    cases jsonb NOT NULL,
    result jsonb,
    cancel_requested boolean DEFAULT false NOT NULL,
    admitted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    match_id uuid,
    match_sequence bigint,
    odyssey_level integer,
    custom_run boolean DEFAULT false NOT NULL,
    interview_id uuid,
    result_payload bytea,
    lossless_cases bytea,
    CONSTRAINT submission_context_check CHECK ((((workspace_id IS NULL) <> (interview_id IS NULL)) AND ((interview_id IS NULL) OR (match_id IS NULL)))),
    CONSTRAINT submissions_kind_check CHECK ((kind = ANY (ARRAY['run'::text, 'submit'::text]))),
    CONSTRAINT submissions_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'cancelled'::text, 'failed'::text])))
);

CREATE TABLE public.team_document_presence (
    match_id uuid NOT NULL,
    team smallint NOT NULL,
    owner_id text NOT NULL,
    client_id text NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.team_document_updates (
    match_id uuid NOT NULL,
    team smallint NOT NULL,
    epoch uuid NOT NULL,
    version bigint NOT NULL,
    client_id text NOT NULL,
    changes jsonb NOT NULL,
    CONSTRAINT team_document_updates_version_check CHECK ((version > 0))
);

CREATE TABLE public.team_votes (
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    team smallint NOT NULL,
    vote jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE public.users (
    id text NOT NULL,
    display_name text NOT NULL,
    admission_tokens double precision DEFAULT 2 NOT NULL,
    tokens_updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    participant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    kind text DEFAULT 'account'::text NOT NULL,
    profile_image text DEFAULT ''::text NOT NULL,
    profile_color integer DEFAULT 0 NOT NULL,
    profile_color_revision bigint DEFAULT 0 NOT NULL,
    CONSTRAINT users_kind_check CHECK ((kind = ANY (ARRAY['account'::text, 'guest'::text]))),
    CONSTRAINT users_profile_color_check CHECK (((profile_color >= 0) AND (profile_color <= 24))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
);

CREATE TABLE public.workspaces (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    problem_version_id uuid,
    language text NOT NULL,
    kind text DEFAULT 'solo'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    match_id uuid,
    review_match_id uuid,
    review_source_owner_id text,
    team smallint,
    CONSTRAINT workspace_match_kind CHECK (((kind = 'match'::text) = (match_id IS NOT NULL))),
    CONSTRAINT workspace_review_kind CHECK ((((kind = 'review'::text) AND (review_match_id IS NOT NULL) AND (review_source_owner_id IS NOT NULL)) OR ((kind <> 'review'::text) AND (review_match_id IS NULL) AND (review_source_owner_id IS NULL)))),
    CONSTRAINT workspace_team_context CHECK (((team IS NULL) OR ((kind = 'match'::text) AND (match_id IS NOT NULL)))),
    CONSTRAINT workspaces_kind_check CHECK ((kind = ANY (ARRAY['solo'::text, 'match'::text, 'review'::text]))),
    CONSTRAINT workspaces_language_check CHECK ((language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text, 'postgresql'::text]))),
    CONSTRAINT workspaces_team_check CHECK (((team >= 1) AND (team <= 4)))
);

ALTER TABLE ONLY public.interview_outbox ALTER COLUMN sequence SET DEFAULT nextval('public.interview_outbox_sequence_seq'::regclass);

ALTER TABLE ONLY public.access_audit
    ADD CONSTRAINT access_audit_pkey PRIMARY KEY (operation_id);

ALTER TABLE ONLY public.cancellation_idempotency
    ADD CONSTRAINT cancellation_idempotency_pkey PRIMARY KEY (owner_id, key);

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deadline_prearms
    ADD CONSTRAINT deadline_prearms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_user_id_feature_source_source_ref_key UNIQUE (user_id, feature, source, source_ref);

ALTER TABLE ONLY public.execution_attempt_inventory
    ADD CONSTRAINT execution_attempt_inventory_pkey PRIMARY KEY (attempt_id);

ALTER TABLE ONLY public.execution_attempt_usage
    ADD CONSTRAINT execution_attempt_usage_pkey PRIMARY KEY (attempt_id);

ALTER TABLE ONLY public.execution_checkpoint_cases
    ADD CONSTRAINT execution_checkpoint_cases_pkey PRIMARY KEY (job_id, ordinal);

ALTER TABLE ONLY public.execution_checkpoints
    ADD CONSTRAINT execution_checkpoints_pkey PRIMARY KEY (job_id);

ALTER TABLE ONLY public.execution_completion_field_chunks
    ADD CONSTRAINT execution_completion_field_chunks_pkey PRIMARY KEY (job_id, channel, ordinal, field, chunk_ordinal);

ALTER TABLE ONLY public.execution_completion_frames
    ADD CONSTRAINT execution_completion_frames_pkey PRIMARY KEY (job_id, channel, ordinal);

ALTER TABLE ONLY public.execution_completion_header_fields
    ADD CONSTRAINT execution_completion_header_fields_pkey PRIMARY KEY (job_id, field);

ALTER TABLE ONLY public.execution_completion_receipts
    ADD CONSTRAINT execution_completion_receipts_pkey PRIMARY KEY (job_id, attempt_id, sandbox_scope);

ALTER TABLE ONLY public.execution_completion_staging
    ADD CONSTRAINT execution_completion_staging_pkey PRIMARY KEY (job_id);

ALTER TABLE ONLY public.execution_dispatch_intents
    ADD CONSTRAINT execution_dispatch_intents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_idempotency
    ADD CONSTRAINT execution_idempotency_pkey PRIMARY KEY (owner_id, key);

ALTER TABLE ONLY public.execution_jobs
    ADD CONSTRAINT execution_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_jobs
    ADD CONSTRAINT execution_jobs_submission_id_key UNIQUE (submission_id);

ALTER TABLE ONLY public.execution_verification_challenges
    ADD CONSTRAINT execution_verification_challenges_job_id_ordinal_key UNIQUE (job_id, ordinal);

ALTER TABLE ONLY public.execution_verification_challenges
    ADD CONSTRAINT execution_verification_challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_verification_output_chunks
    ADD CONSTRAINT execution_verification_output_chunks_pkey PRIMARY KEY (challenge_id, field, ordinal);

ALTER TABLE ONLY public.execution_verified_cases
    ADD CONSTRAINT execution_verified_cases_pkey PRIMARY KEY (job_id, attempt_id, ordinal);

ALTER TABLE ONLY public.guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_pkey PRIMARY KEY (submission_id);

ALTER TABLE ONLY public.guest_request_buckets
    ADD CONSTRAINT guest_request_buckets_pkey PRIMARY KEY (key, window_start);

ALTER TABLE ONLY public.guest_sessions
    ADD CONSTRAINT guest_sessions_owner_id_key UNIQUE (owner_id);

ALTER TABLE ONLY public.guest_sessions
    ADD CONSTRAINT guest_sessions_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY public.guest_sponsor_locks
    ADD CONSTRAINT guest_sponsor_locks_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.identity_bindings
    ADD CONSTRAINT identity_bindings_pkey PRIMARY KEY (issuer, subject);

ALTER TABLE ONLY public.interview_active_runner_inputs
    ADD CONSTRAINT interview_active_runner_inputs_pkey PRIMARY KEY (session_id);

ALTER TABLE ONLY public.interview_case_visibility
    ADD CONSTRAINT interview_case_visibility_pkey PRIMARY KEY (session_id, question_epoch, case_id);

ALTER TABLE ONLY public.interview_execution
    ADD CONSTRAINT interview_execution_identity UNIQUE (submission_id, session_id);

ALTER TABLE ONLY public.interview_execution
    ADD CONSTRAINT interview_execution_pkey PRIMARY KEY (submission_id);

ALTER TABLE ONLY public.interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_owner_id_key UNIQUE (owner_id);

ALTER TABLE ONLY public.interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY public.interview_language_drafts
    ADD CONSTRAINT interview_language_drafts_pkey PRIMARY KEY (session_id, question_epoch, language);

ALTER TABLE ONLY public.interview_members
    ADD CONSTRAINT interview_members_pkey PRIMARY KEY (session_id, user_id);

ALTER TABLE ONLY public.interview_operations
    ADD CONSTRAINT interview_operations_pkey PRIMARY KEY (owner_id, key);

ALTER TABLE ONLY public.interview_outbox
    ADD CONSTRAINT interview_outbox_id_key UNIQUE (id);

ALTER TABLE ONLY public.interview_outbox
    ADD CONSTRAINT interview_outbox_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.interview_presence
    ADD CONSTRAINT interview_presence_pkey PRIMARY KEY (session_id, user_id, client_id);

ALTER TABLE ONLY public.interview_private_case_statuses
    ADD CONSTRAINT interview_private_case_statuses_pkey PRIMARY KEY (submission_id, ordinal);

ALTER TABLE ONLY public.interview_private_case_statuses
    ADD CONSTRAINT interview_private_case_statuses_submission_id_case_id_key UNIQUE (submission_id, case_id);

ALTER TABLE ONLY public.interview_private_result_cases
    ADD CONSTRAINT interview_private_result_cases_pkey PRIMARY KEY (submission_id, ordinal);

ALTER TABLE ONLY public.interview_private_status_headers
    ADD CONSTRAINT interview_private_status_headers_pkey PRIMARY KEY (submission_id);

ALTER TABLE ONLY public.interview_public_examples
    ADD CONSTRAINT interview_public_examples_pkey PRIMARY KEY (session_id, question_epoch, level);

ALTER TABLE ONLY public.interview_question_private_cases
    ADD CONSTRAINT interview_question_private_ca_session_id_question_epoch_ord_key UNIQUE (session_id, question_epoch, ordinal);

ALTER TABLE ONLY public.interview_question_private_cases
    ADD CONSTRAINT interview_question_private_cases_pkey PRIMARY KEY (session_id, question_epoch, case_id);

ALTER TABLE ONLY public.interview_question_snapshots
    ADD CONSTRAINT interview_question_snapshots_pkey PRIMARY KEY (session_id, id);

ALTER TABLE ONLY public.interview_rule_events
    ADD CONSTRAINT interview_rule_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.interview_snapshot_public_examples
    ADD CONSTRAINT interview_snapshot_public_examples_pkey PRIMARY KEY (session_id, fixture_id, level);

ALTER TABLE ONLY public.interview_updates
    ADD CONSTRAINT interview_updates_pkey PRIMARY KEY (session_id, epoch, version);

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_invite_hash_key UNIQUE (invite_hash);

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.maintenance_schedule
    ADD CONSTRAINT maintenance_schedule_pkey PRIMARY KEY (task);

ALTER TABLE ONLY public.match_idempotency
    ADD CONSTRAINT match_idempotency_pkey PRIMARY KEY (owner_id, route, key);

ALTER TABLE ONLY public.match_outbox
    ADD CONSTRAINT match_outbox_id_key UNIQUE (id);

ALTER TABLE ONLY public.match_outbox
    ADD CONSTRAINT match_outbox_match_id_version_key UNIQUE (match_id, version);

ALTER TABLE ONLY public.match_outbox
    ADD CONSTRAINT match_outbox_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.match_participants
    ADD CONSTRAINT match_participants_match_id_seat_key UNIQUE (match_id, seat);

ALTER TABLE ONLY public.match_participants
    ADD CONSTRAINT match_participants_pkey PRIMARY KEY (match_id, owner_id);

ALTER TABLE ONLY public.match_private_result_cases
    ADD CONSTRAINT match_private_result_cases_pkey PRIMARY KEY (submission_id, ordinal);

ALTER TABLE ONLY public.match_reconciliation_pending
    ADD CONSTRAINT match_reconciliation_pending_pkey PRIMARY KEY (match_id);

ALTER TABLE ONLY public.match_reservations
    ADD CONSTRAINT match_reservations_pkey PRIMARY KEY (owner_id);

ALTER TABLE ONLY public.match_rule_events
    ADD CONSTRAINT match_rule_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.match_teams
    ADD CONSTRAINT match_teams_pkey PRIMARY KEY (match_id, team);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_invite_hash_key UNIQUE (invite_hash);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.odyssey_progress
    ADD CONSTRAINT odyssey_progress_pkey PRIMARY KEY (scope_id, problem_version_id);

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_invite_hash_key UNIQUE (invite_hash);

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.party_members
    ADD CONSTRAINT party_members_owner_id_key UNIQUE (owner_id);

ALTER TABLE ONLY public.party_members
    ADD CONSTRAINT party_members_party_id_seat_key UNIQUE (party_id, seat);

ALTER TABLE ONLY public.party_members
    ADD CONSTRAINT party_members_pkey PRIMARY KEY (party_id, owner_id);

ALTER TABLE ONLY public.platform_presence_leases
    ADD CONSTRAINT platform_presence_leases_pkey PRIMARY KEY (owner_id, window_id);

ALTER TABLE ONLY public.practice_case_feedback
    ADD CONSTRAINT practice_case_feedback_pkey PRIMARY KEY (workspace_id, case_index);

ALTER TABLE ONLY public.practice_solves
    ADD CONSTRAINT practice_solves_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY public.problem_companies
    ADD CONSTRAINT problem_companies_pkey PRIMARY KEY (problem_id, company_id);

ALTER TABLE ONLY public.problem_examples
    ADD CONSTRAINT problem_examples_pkey PRIMARY KEY (version_id, ordinal);

ALTER TABLE ONLY public.problem_odyssey_cases
    ADD CONSTRAINT problem_odyssey_cases_pkey PRIMARY KEY (version_id, level, ordinal);

ALTER TABLE ONLY public.problem_solution_approaches
    ADD CONSTRAINT problem_solution_approaches_pkey PRIMARY KEY (version_id, id);

ALTER TABLE ONLY public.problem_solution_approaches
    ADD CONSTRAINT problem_solution_approaches_version_id_ordinal_key UNIQUE (version_id, ordinal);

ALTER TABLE ONLY public.problem_solutions
    ADD CONSTRAINT problem_solutions_pkey PRIMARY KEY (version_id, approach_id, language);

ALTER TABLE ONLY public.problem_tags
    ADD CONSTRAINT problem_tags_pkey PRIMARY KEY (version_id, tag);

ALTER TABLE ONLY public.problem_tags
    ADD CONSTRAINT problem_tags_version_id_ordinal_key UNIQUE (version_id, ordinal);

ALTER TABLE ONLY public.problem_test_cases
    ADD CONSTRAINT problem_test_cases_pkey PRIMARY KEY (version_id, ordinal);

ALTER TABLE ONLY public.problem_versions
    ADD CONSTRAINT problem_version_identity UNIQUE (problem_id, id);

ALTER TABLE ONLY public.problem_versions
    ADD CONSTRAINT problem_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.problem_versions
    ADD CONSTRAINT problem_versions_problem_version_key UNIQUE (problem_id, version);

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT problems_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT problems_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.quota_overrides
    ADD CONSTRAINT quota_overrides_pkey PRIMARY KEY (user_id, resource);

ALTER TABLE ONLY public.realtime_presence_leases
    ADD CONSTRAINT realtime_presence_leases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.runner_input_blobs
    ADD CONSTRAINT runner_input_blobs_pkey PRIMARY KEY (hash);

ALTER TABLE ONLY public.runner_input_gc_state
    ADD CONSTRAINT runner_input_gc_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.runner_job_input_cases
    ADD CONSTRAINT runner_job_input_cases_pkey PRIMARY KEY (job_id, ordinal);

ALTER TABLE ONLY public.runner_job_input_digests
    ADD CONSTRAINT runner_job_input_digests_pkey PRIMARY KEY (job_id);

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_pkey PRIMARY KEY (job_id);

ALTER TABLE ONLY public.runner_snapshot_input_cases
    ADD CONSTRAINT runner_snapshot_input_cases_pkey PRIMARY KEY (session_id, fixture_id, channel, stage, ordinal);

ALTER TABLE ONLY public.runner_snapshot_inputs
    ADD CONSTRAINT runner_snapshot_inputs_pkey PRIMARY KEY (session_id, fixture_id);

ALTER TABLE ONLY public.runner_version_input_cases
    ADD CONSTRAINT runner_version_input_cases_pkey PRIMARY KEY (version_id, channel, stage, ordinal);

ALTER TABLE ONLY public.runner_version_inputs
    ADD CONSTRAINT runner_version_inputs_pkey PRIMARY KEY (version_id);

ALTER TABLE ONLY public.stage_genesis
    ADD CONSTRAINT stage_genesis_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submission_interview_identity UNIQUE (id, interview_id);

ALTER TABLE ONLY public.submission_outbox
    ADD CONSTRAINT submission_outbox_id_key UNIQUE (id);

ALTER TABLE ONLY public.submission_outbox
    ADD CONSTRAINT submission_outbox_pkey PRIMARY KEY (sequence);

ALTER TABLE ONLY public.submission_public_case_statuses
    ADD CONSTRAINT submission_public_case_statuses_pkey PRIMARY KEY (submission_id, channel, ordinal);

ALTER TABLE ONLY public.submission_public_result_cases
    ADD CONSTRAINT submission_public_result_cases_pkey PRIMARY KEY (submission_id, channel, ordinal);

ALTER TABLE ONLY public.submission_result_header_fields
    ADD CONSTRAINT submission_result_header_fields_pkey PRIMARY KEY (submission_id, field);

ALTER TABLE ONLY public.submission_result_headers
    ADD CONSTRAINT submission_result_headers_pkey PRIMARY KEY (submission_id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team_document_presence
    ADD CONSTRAINT team_document_presence_pkey PRIMARY KEY (match_id, team, owner_id, client_id);

ALTER TABLE ONLY public.team_document_updates
    ADD CONSTRAINT team_document_updates_pkey PRIMARY KEY (match_id, team, epoch, version);

ALTER TABLE ONLY public.team_votes
    ADD CONSTRAINT team_votes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_participant_id_key UNIQUE (participant_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspace_owner_identity UNIQUE (id, owner_id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

CREATE INDEX cancellation_idempotency_expiry ON public.cancellation_idempotency USING btree (expires_at);

CREATE UNIQUE INDEX companies_name_ci ON public.companies USING btree (lower(name));

CREATE INDEX deadline_prearms_shard ON public.deadline_prearms USING btree (purpose, shard, expires_at, id);

CREATE INDEX entitlement_grants_unrevoked ON public.entitlement_grants USING btree (user_id, feature) WHERE (revoked_at IS NULL);

CREATE INDEX execution_attempt_inventory_scope_attempt_idx ON public.execution_attempt_inventory USING btree (sandbox_scope, attempt_id);

CREATE INDEX execution_dispatch_pending ON public.execution_dispatch_intents USING btree (available_at, id) WHERE (delivered_at IS NULL);

CREATE INDEX execution_idempotency_expiry ON public.execution_idempotency USING btree (expires_at);

CREATE INDEX guest_request_buckets_window ON public.guest_request_buckets USING btree (window_start);

CREATE INDEX guest_sessions_expiry ON public.guest_sessions USING btree (expires_at);

CREATE INDEX guest_usage_active_sponsor ON public.guest_execution_usage USING btree (sponsor_id) WHERE (settled_at IS NULL);

CREATE INDEX guest_usage_room ON public.guest_execution_usage USING btree (match_id);

CREATE INDEX guest_usage_sponsor ON public.guest_execution_usage USING btree (sponsor_id, admitted_at);

CREATE INDEX interview_execution_question ON public.interview_execution USING btree (session_id, question_epoch, submission_id);

CREATE INDEX interview_execution_session ON public.interview_execution USING btree (session_id, submission_id);

CREATE INDEX interview_guest_sessions_session ON public.interview_guest_sessions USING btree (session_id);

CREATE UNIQUE INDEX interview_interviewer_invite ON public.interviews USING btree (interviewer_invite_hash);

CREATE INDEX interview_members_user ON public.interview_members USING btree (user_id) WHERE (removed_at IS NULL);

CREATE INDEX interview_outbox_pending ON public.interview_outbox USING btree (sequence) WHERE (published_at IS NULL);

CREATE INDEX interview_outbox_retention ON public.interview_outbox USING btree (occurred_at, sequence) WHERE (published_at IS NOT NULL);

CREATE INDEX interview_rule_events_actor ON public.interview_rule_events USING btree (session_id, owner_id, kind, occurred_at DESC);

CREATE INDEX interview_rule_events_recent ON public.interview_rule_events USING btree (session_id, occurred_at DESC, id DESC);

CREATE INDEX interviews_host_active ON public.interviews USING btree (host_id) WHERE (state = 'active'::text);

CREATE INDEX jobs_claim ON public.execution_jobs USING btree (available_at) WHERE (NOT finished);

CREATE INDEX match_idempotency_expiry ON public.match_idempotency USING btree (expires_at);

CREATE INDEX match_outbox_retention ON public.match_outbox USING btree (occurred_at, sequence) WHERE (published_at IS NOT NULL);

CREATE INDEX match_reconciliation_order ON public.matches USING btree (reconciled_at, id) WHERE (state <> ALL (ARRAY['completed'::text, 'cancelled'::text]));

CREATE INDEX match_reservations_match ON public.match_reservations USING btree (match_id, owner_id);

CREATE INDEX match_rule_competitor ON public.match_rule_events USING btree (match_id, competitor_id, occurred_at);

CREATE INDEX match_rule_events_match ON public.match_rule_events USING btree (match_id, occurred_at);

CREATE UNIQUE INDEX match_rule_reveal_once ON public.match_rule_events USING btree (match_id, competitor_id, kind, resource_key) WHERE (resource_key IS NOT NULL);

CREATE INDEX match_submission_history ON public.submissions USING btree (match_id, admitted_at, match_sequence) WHERE ((match_id IS NOT NULL) AND (kind = 'submit'::text));

CREATE UNIQUE INDEX match_submission_order ON public.submissions USING btree (match_id, match_sequence) WHERE (match_sequence IS NOT NULL);

CREATE UNIQUE INDEX match_workspace_owner_language ON public.workspaces USING btree (match_id, owner_id, language) WHERE (kind = 'match'::text);

CREATE INDEX matches_reconcile ON public.matches USING btree (state, deadline, expires_at) WHERE (state <> ALL (ARRAY['completed'::text, 'cancelled'::text]));

CREATE UNIQUE INDEX owner_busy ON public.submissions USING btree (owner_id) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX parties_countdown ON public.parties USING btree (countdown_ends_at) WHERE (countdown_ends_at IS NOT NULL);

CREATE INDEX party_members_last_seen ON public.party_members USING btree (last_seen_at);

CREATE INDEX platform_presence_expiry ON public.platform_presence_leases USING btree (expires_at);

CREATE INDEX problem_companies_company_id ON public.problem_companies USING btree (company_id, problem_id);

CREATE UNIQUE INDEX problem_solution_approaches_canonical ON public.problem_solution_approaches USING btree (version_id) WHERE is_canonical;

CREATE UNIQUE INDEX problems_leetcode_id ON public.problems USING btree (leetcode_id) WHERE (leetcode_id IS NOT NULL);

CREATE INDEX problems_private_owner ON public.problems USING btree (owner_id) WHERE (owner_id IS NOT NULL);

CREATE INDEX question_drafts_created_by ON public.question_drafts USING btree (created_by);

CREATE UNIQUE INDEX question_drafts_edit_version ON public.question_drafts USING btree (edit_version_id) WHERE (edit_version_id IS NOT NULL);

CREATE UNIQUE INDEX question_drafts_import_digest ON public.question_drafts USING btree (created_by, import_digest) WHERE (import_digest IS NOT NULL);

CREATE INDEX question_drafts_private_owner ON public.question_drafts USING btree (owner_id, updated_at DESC, id DESC);

CREATE INDEX question_drafts_published_version ON public.question_drafts USING btree (published_version_id);

CREATE INDEX question_drafts_updated_at ON public.question_drafts USING btree (updated_at DESC, id);

CREATE INDEX question_drafts_updated_by ON public.question_drafts USING btree (updated_by);

CREATE INDEX realtime_presence_expiry ON public.realtime_presence_leases USING btree (expires_at);

CREATE INDEX realtime_presence_subject ON public.realtime_presence_leases USING btree (topic, subject, expires_at);

CREATE UNIQUE INDEX review_workspace_owner_source_language ON public.workspaces USING btree (review_match_id, owner_id, review_source_owner_id, language) WHERE (kind = 'review'::text);

CREATE INDEX runner_job_input_cases_blob_hash_idx ON public.runner_job_input_cases USING btree (blob_hash);

CREATE INDEX runner_job_inputs_metadata_hash_idx ON public.runner_job_inputs USING btree (metadata_hash);

CREATE INDEX runner_job_inputs_source_hash_idx ON public.runner_job_inputs USING btree (source_hash);

CREATE INDEX runner_snapshot_input_cases_blob_hash_idx ON public.runner_snapshot_input_cases USING btree (blob_hash);

CREATE INDEX runner_snapshot_inputs_metadata_hash_idx ON public.runner_snapshot_inputs USING btree (metadata_hash);

CREATE INDEX runner_version_input_cases_blob_hash_idx ON public.runner_version_input_cases USING btree (blob_hash);

CREATE INDEX runner_version_inputs_metadata_hash_idx ON public.runner_version_inputs USING btree (metadata_hash);

CREATE UNIQUE INDEX solo_workspace ON public.workspaces USING btree (owner_id, problem_version_id, language) WHERE (kind = 'solo'::text);

CREATE INDEX submission_odyssey_history ON public.submissions USING btree (workspace_id, admitted_at DESC, id DESC) WHERE ((state = 'completed'::text) AND (NOT custom_run) AND (odyssey_level IS NOT NULL));

CREATE INDEX submission_outbox_pending ON public.submission_outbox USING btree (sequence) WHERE (published_at IS NULL);

CREATE INDEX submission_outbox_retention ON public.submission_outbox USING btree (occurred_at, sequence) WHERE (published_at IS NOT NULL);

CREATE INDEX submission_practice_latest ON public.submissions USING btree (workspace_id, odyssey_level, admitted_at, id) WHERE ((match_id IS NULL) AND (kind = 'submit'::text) AND (state = 'completed'::text));

CREATE INDEX submission_quota ON public.submissions USING btree (owner_id, admitted_at DESC);

CREATE INDEX submission_workspace_active ON public.submissions USING btree (workspace_id) WHERE ((workspace_id IS NOT NULL) AND (state = ANY (ARRAY['queued'::text, 'running'::text])));

CREATE INDEX submissions_interview ON public.submissions USING btree (interview_id) WHERE (interview_id IS NOT NULL);

CREATE INDEX team_votes_team ON public.team_votes USING btree (match_id, team, created_at DESC);

CREATE INDEX unpublished_match_events ON public.match_outbox USING btree (sequence) WHERE (published_at IS NULL);

CREATE TRIGGER execution_attempt_inventory_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.execution_attempt_inventory FOR EACH STATEMENT EXECUTE FUNCTION public.guard_execution_attempt_inventory();

CREATE TRIGGER execution_attempt_inventory_record AFTER INSERT OR UPDATE OF attempt_id, sandbox_scope ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.record_execution_attempt();

CREATE TRIGGER execution_cancellation_notification AFTER UPDATE OF cancel_requested ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.notify_execution_cancellation();

CREATE TRIGGER execution_checkpoint_claim_guard BEFORE UPDATE OF attempt_id ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_checkpoint_claim();

CREATE TRIGGER execution_checkpoint_terminal_cleanup AFTER UPDATE OF finished ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.cleanup_terminal_checkpoint();

CREATE TRIGGER execution_completion_terminal_cleanup AFTER UPDATE OF finished ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.cleanup_terminal_completion_staging();

CREATE TRIGGER execution_jobs_wakeup_delete AFTER DELETE ON public.execution_jobs FOR EACH STATEMENT EXECUTE FUNCTION public.notify_execution_jobs();

CREATE TRIGGER execution_jobs_wakeup_insert AFTER INSERT ON public.execution_jobs FOR EACH STATEMENT EXECUTE FUNCTION public.notify_execution_jobs();

CREATE TRIGGER execution_jobs_wakeup_update AFTER UPDATE OF available_at, lease_until, attempt_id, finished ON public.execution_jobs FOR EACH ROW WHEN (((old.available_at IS DISTINCT FROM new.available_at) OR (old.attempt_id IS DISTINCT FROM new.attempt_id) OR (old.finished IS DISTINCT FROM new.finished) OR ((old.lease_until IS NOT NULL) AND ((new.lease_until IS NULL) OR (new.lease_until < old.lease_until))))) EXECUTE FUNCTION public.notify_execution_jobs();

CREATE TRIGGER execution_lossless_case_claim_guard BEFORE UPDATE OF attempt_id ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_lossless_case_claim();

CREATE TRIGGER execution_reclaim_guard BEFORE UPDATE OF attempt_id ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_expired_attempt_reclaim();

CREATE TRIGGER execution_verified_case_immutable BEFORE DELETE OR UPDATE ON public.execution_verified_cases FOR EACH ROW EXECUTE FUNCTION public.execution_verified_case_guard();

CREATE TRIGGER finished_match_reconciliation AFTER UPDATE OF state ON public.matches FOR EACH ROW EXECUTE FUNCTION public.clear_finished_match_reconciliation();

CREATE TRIGGER immutable_access_audit BEFORE DELETE OR UPDATE ON public.access_audit FOR EACH ROW EXECUTE FUNCTION public.immutable_access_audit();

CREATE TRIGGER immutable_interview_execution_context BEFORE UPDATE ON public.interview_execution FOR EACH ROW EXECUTE FUNCTION public.immutable_interview_execution_context();

CREATE TRIGGER immutable_interview_question_snapshot BEFORE UPDATE ON public.interview_question_snapshots FOR EACH ROW EXECUTE FUNCTION public.immutable_interview_question_snapshot();

CREATE TRIGGER immutable_problem_case BEFORE UPDATE ON public.problem_test_cases FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_example BEFORE UPDATE ON public.problem_examples FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_odyssey_case BEFORE UPDATE ON public.problem_odyssey_cases FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_solution BEFORE UPDATE ON public.problem_solutions FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_solution_approach BEFORE UPDATE ON public.problem_solution_approaches FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_tag BEFORE UPDATE ON public.problem_tags FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_problem_version BEFORE UPDATE ON public.problem_versions FOR EACH ROW EXECUTE FUNCTION public.immutable_problem_content();

CREATE TRIGGER immutable_workspace_identity BEFORE UPDATE OF owner_id, problem_version_id, language, kind, match_id, review_match_id, review_source_owner_id ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_identity();

CREATE TRIGGER interview_active_runner_input_guard BEFORE INSERT OR UPDATE ON public.interview_active_runner_inputs FOR EACH ROW EXECUTE FUNCTION public.interview_active_runner_input_guard();

CREATE TRIGGER interview_case_realtime AFTER INSERT OR DELETE ON public.interview_case_visibility FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER interview_clear_stale_runner_input AFTER UPDATE OF question_epoch ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.interview_clear_stale_runner_input();

CREATE TRIGGER interview_execution_realtime AFTER INSERT OR UPDATE ON public.interview_execution FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER interview_lossless_guard BEFORE UPDATE OF question ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.guard_lossless_interview_update();

CREATE TRIGGER interview_member_realtime AFTER INSERT OR UPDATE ON public.interview_members FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER interview_presence_realtime AFTER INSERT OR DELETE OR UPDATE ON public.interview_presence FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER interview_private_case_statuses_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.interview_private_case_statuses FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER interview_private_result_cases_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.interview_private_result_cases FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER interview_private_result_payload_consistency BEFORE UPDATE OF private_results ON public.interview_execution FOR EACH ROW EXECUTE FUNCTION public.clear_legacy_private_result_payload();

CREATE TRIGGER interview_private_status_headers_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.interview_private_status_headers FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER interview_realtime AFTER UPDATE ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER interview_result_payload_retention AFTER UPDATE OF result ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.clear_interview_result_payload();

CREATE TRIGGER interview_result_realtime AFTER UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.interview_changed();

CREATE TRIGGER match_deadline_schedule AFTER INSERT OR DELETE OR UPDATE OF state, started_at, deadline, finalizing_at, expires_at ON public.matches FOR EACH STATEMENT EXECUTE FUNCTION public.notify_match_deadline_schedule();

CREATE TRIGGER match_outbox_notification AFTER INSERT ON public.match_outbox FOR EACH STATEMENT EXECUTE FUNCTION public.notify_match_outbox();

CREATE TRIGGER match_submission_reconciliation AFTER UPDATE OF state ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.queue_match_reconciliation();

CREATE TRIGGER meter_guest_execution BEFORE UPDATE ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.meter_guest_execution();

CREATE TRIGGER normalized_submission_result_retention AFTER UPDATE OF result ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.clear_normalized_submission_results();

CREATE CONSTRAINT TRIGGER participant_workspace_access AFTER INSERT OR UPDATE OF workspace_id, owner_id, match_id, team ON public.match_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_team_workspace_access();

CREATE TRIGGER participant_workspace_match BEFORE INSERT OR UPDATE OF workspace_id, match_id ON public.match_participants FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_match_context();

CREATE TRIGGER practice_feedback_retention BEFORE UPDATE OF result ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.retain_practice_feedback();

CREATE TRIGGER question_draft_lossless_guard BEFORE UPDATE OF content ON public.question_drafts FOR EACH ROW EXECUTE FUNCTION public.guard_lossless_draft_update();

CREATE TRIGGER runner_input_blob_immutable BEFORE UPDATE ON public.runner_input_blobs FOR EACH ROW EXECUTE FUNCTION public.runner_input_blob_immutable();

CREATE TRIGGER runner_job_input_cases_guard BEFORE INSERT OR DELETE OR UPDATE ON public.runner_job_input_cases FOR EACH ROW EXECUTE FUNCTION public.runner_input_index_guard();

CREATE TRIGGER runner_job_input_delete_guard BEFORE DELETE ON public.runner_job_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_root_delete_guard();

CREATE TRIGGER runner_job_input_digest_seal AFTER UPDATE OF sealed ON public.runner_job_inputs FOR EACH ROW WHEN (((NOT old.sealed) AND new.sealed)) EXECUTE FUNCTION public.seal_runner_job_input_digest();

CREATE TRIGGER runner_job_input_digests_guard BEFORE INSERT OR DELETE OR UPDATE ON public.runner_job_input_digests FOR EACH ROW EXECUTE FUNCTION public.runner_job_input_digest_guard();

CREATE TRIGGER runner_job_inputs_guard BEFORE INSERT OR UPDATE ON public.runner_job_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_manifest_guard();

CREATE TRIGGER runner_manifest_claim_guard BEFORE UPDATE OF attempt_id ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION public.runner_manifest_claim_guard();

CREATE TRIGGER runner_snapshot_input_cases_guard BEFORE INSERT OR DELETE OR UPDATE ON public.runner_snapshot_input_cases FOR EACH ROW EXECUTE FUNCTION public.runner_input_index_guard();

CREATE TRIGGER runner_snapshot_input_delete_guard BEFORE DELETE ON public.runner_snapshot_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_root_delete_guard();

CREATE TRIGGER runner_snapshot_inputs_guard BEFORE INSERT OR UPDATE ON public.runner_snapshot_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_manifest_guard();

CREATE TRIGGER runner_version_input_cases_guard BEFORE INSERT OR DELETE OR UPDATE ON public.runner_version_input_cases FOR EACH ROW EXECUTE FUNCTION public.runner_input_index_guard();

CREATE TRIGGER runner_version_input_delete_guard BEFORE DELETE ON public.runner_version_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_root_delete_guard();

CREATE TRIGGER runner_version_inputs_guard BEFORE INSERT OR UPDATE ON public.runner_version_inputs FOR EACH ROW EXECUTE FUNCTION public.runner_input_manifest_guard();

CREATE TRIGGER sealed_problem_case BEFORE INSERT OR DELETE OR UPDATE ON public.problem_test_cases FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_delete BEFORE DELETE ON public.problem_versions FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_delete();

CREATE TRIGGER sealed_problem_example BEFORE INSERT OR DELETE OR UPDATE ON public.problem_examples FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_odyssey_case BEFORE INSERT OR DELETE OR UPDATE ON public.problem_odyssey_cases FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_solution BEFORE INSERT OR DELETE OR UPDATE ON public.problem_solutions FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_solution_approach BEFORE INSERT OR DELETE OR UPDATE ON public.problem_solution_approaches FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_tag BEFORE INSERT OR DELETE OR UPDATE ON public.problem_tags FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_problem_child();

CREATE TRIGGER stage_genesis_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.stage_genesis FOR EACH STATEMENT EXECUTE FUNCTION public.guard_stage_genesis();

CREATE TRIGGER submission_lossless_case_guard BEFORE UPDATE OF cases ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.guard_lossless_case_cleanup();

CREATE TRIGGER submission_notice AFTER INSERT OR UPDATE OF state, result, cancel_requested ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.queue_submission_notice();

CREATE TRIGGER submission_public_case_statuses_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.submission_public_case_statuses FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER submission_public_result_cases_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.submission_public_result_cases FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER submission_result_header_fields_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.submission_result_header_fields FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER submission_result_headers_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.submission_result_headers FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_result_rows();

CREATE TRIGGER submission_result_payload_retention BEFORE UPDATE OF result ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.clear_submission_result_payload();

CREATE CONSTRAINT TRIGGER submission_workspace_access AFTER INSERT OR UPDATE OF workspace_id, owner_id, match_id ON public.submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_team_workspace_access();

CREATE TRIGGER submission_workspace_match BEFORE INSERT OR UPDATE OF workspace_id, match_id ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_match_context();

ALTER TABLE ONLY public.access_audit
    ADD CONSTRAINT access_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.cancellation_idempotency
    ADD CONSTRAINT cancellation_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.cancellation_idempotency
    ADD CONSTRAINT cancellation_idempotency_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id);

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT current_publication_identity FOREIGN KEY (id, current_version_id) REFERENCES public.problem_versions(problem_id, id) ON DELETE SET NULL (current_version_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.execution_attempt_usage
    ADD CONSTRAINT execution_attempt_usage_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_checkpoint_cases
    ADD CONSTRAINT execution_checkpoint_cases_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_checkpoints(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_checkpoints
    ADD CONSTRAINT execution_checkpoints_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_completion_field_chunks
    ADD CONSTRAINT execution_completion_field_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_completion_staging(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_completion_frames
    ADD CONSTRAINT execution_completion_frames_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_completion_staging(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_completion_header_fields
    ADD CONSTRAINT execution_completion_header_fields_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_completion_staging(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_completion_receipts
    ADD CONSTRAINT execution_completion_receipts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_completion_staging
    ADD CONSTRAINT execution_completion_staging_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_dispatch_intents
    ADD CONSTRAINT execution_dispatch_intents_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_idempotency
    ADD CONSTRAINT execution_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.execution_idempotency
    ADD CONSTRAINT execution_idempotency_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id);

ALTER TABLE ONLY public.execution_jobs
    ADD CONSTRAINT execution_jobs_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id);

ALTER TABLE ONLY public.execution_verification_challenges
    ADD CONSTRAINT execution_verification_challenges_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_completion_staging(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_verification_challenges
    ADD CONSTRAINT execution_verification_challenges_job_id_ordinal_fkey FOREIGN KEY (job_id, ordinal) REFERENCES public.runner_job_input_cases(job_id, ordinal);

ALTER TABLE ONLY public.execution_verification_output_chunks
    ADD CONSTRAINT execution_verification_output_chunks_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.execution_verification_challenges(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_verified_cases
    ADD CONSTRAINT execution_verified_cases_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_verified_cases
    ADD CONSTRAINT execution_verified_cases_job_id_ordinal_fkey FOREIGN KEY (job_id, ordinal) REFERENCES public.runner_job_input_cases(job_id, ordinal);

ALTER TABLE ONLY public.guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_sponsor_id_fkey FOREIGN KEY (sponsor_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guest_sessions
    ADD CONSTRAINT guest_sessions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.guest_sessions
    ADD CONSTRAINT guest_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.guest_sessions
    ADD CONSTRAINT guest_sessions_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.parties(id);

ALTER TABLE ONLY public.guest_sponsor_locks
    ADD CONSTRAINT guest_sponsor_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.identity_bindings
    ADD CONSTRAINT identity_bindings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.interview_active_runner_inputs
    ADD CONSTRAINT interview_active_runner_inputs_session_id_fixture_id_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.runner_snapshot_inputs(session_id, fixture_id);

ALTER TABLE ONLY public.interview_active_runner_inputs
    ADD CONSTRAINT interview_active_runner_inputs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_case_visibility
    ADD CONSTRAINT interview_case_visibility_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_execution
    ADD CONSTRAINT interview_execution_fixture_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.interview_question_snapshots(session_id, id);

ALTER TABLE ONLY public.interview_execution
    ADD CONSTRAINT interview_execution_submission_session_fkey FOREIGN KEY (submission_id, session_id) REFERENCES public.submissions(id, interview_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_language_drafts
    ADD CONSTRAINT interview_language_drafts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_members
    ADD CONSTRAINT interview_members_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_members
    ADD CONSTRAINT interview_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.interview_operations
    ADD CONSTRAINT interview_operations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.interview_operations
    ADD CONSTRAINT interview_operations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_outbox
    ADD CONSTRAINT interview_outbox_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_presence
    ADD CONSTRAINT interview_presence_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_presence
    ADD CONSTRAINT interview_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.interview_private_case_statuses
    ADD CONSTRAINT interview_private_case_statuses_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.interview_private_status_headers(submission_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_private_result_cases
    ADD CONSTRAINT interview_private_result_cases_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.interview_execution(submission_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_private_status_headers
    ADD CONSTRAINT interview_private_status_headers_result_fkey FOREIGN KEY (submission_id) REFERENCES public.submission_result_headers(submission_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_private_status_headers
    ADD CONSTRAINT interview_private_status_headers_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.interview_execution(submission_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_public_examples
    ADD CONSTRAINT interview_public_examples_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_question_private_cases
    ADD CONSTRAINT interview_question_private_cases_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_question_snapshots
    ADD CONSTRAINT interview_question_snapshots_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_rule_events
    ADD CONSTRAINT interview_rule_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_rule_events
    ADD CONSTRAINT interview_rule_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_snapshot_public_examples
    ADD CONSTRAINT interview_snapshot_public_examples_session_id_fixture_id_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.interview_question_snapshots(session_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interview_updates
    ADD CONSTRAINT interview_updates_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.match_idempotency
    ADD CONSTRAINT match_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.match_outbox
    ADD CONSTRAINT match_outbox_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.match_participants
    ADD CONSTRAINT match_participants_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.match_participants
    ADD CONSTRAINT match_participants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.match_private_result_cases
    ADD CONSTRAINT match_private_result_cases_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.match_reconciliation_pending
    ADD CONSTRAINT match_reconciliation_pending_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.match_reservations
    ADD CONSTRAINT match_reservations_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.match_reservations
    ADD CONSTRAINT match_reservations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.match_rule_events
    ADD CONSTRAINT match_rule_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.match_rule_events
    ADD CONSTRAINT match_rule_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.match_teams
    ADD CONSTRAINT match_teams_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.match_teams
    ADD CONSTRAINT match_teams_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_host_owner_id_fkey FOREIGN KEY (host_owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.parties(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_problem_version_id_fkey FOREIGN KEY (problem_version_id) REFERENCES public.problem_versions(id) DEFERRABLE;

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_selected_problem_version_id_fkey FOREIGN KEY (selected_problem_version_id) REFERENCES public.problem_versions(id) DEFERRABLE;

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_current_match_id_fkey FOREIGN KEY (current_match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_host_owner_id_fkey FOREIGN KEY (host_owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_latest_match_id_fkey FOREIGN KEY (latest_match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.party_members
    ADD CONSTRAINT party_members_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.party_members
    ADD CONSTRAINT party_members_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.parties(id);

ALTER TABLE ONLY public.platform_presence_leases
    ADD CONSTRAINT platform_presence_leases_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.practice_case_feedback
    ADD CONSTRAINT practice_case_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.practice_solves
    ADD CONSTRAINT practice_solves_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_companies
    ADD CONSTRAINT problem_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_companies
    ADD CONSTRAINT problem_companies_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_examples
    ADD CONSTRAINT problem_examples_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_odyssey_cases
    ADD CONSTRAINT problem_odyssey_cases_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_solution_approaches
    ADD CONSTRAINT problem_solution_approaches_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_solutions
    ADD CONSTRAINT problem_solutions_approach_fkey FOREIGN KEY (version_id, approach_id) REFERENCES public.problem_solution_approaches(version_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_tags
    ADD CONSTRAINT problem_tags_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_test_cases
    ADD CONSTRAINT problem_test_cases_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.problem_versions
    ADD CONSTRAINT problem_versions_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id);

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT problems_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_edit_version_fkey FOREIGN KEY (edit_version_id) REFERENCES public.problem_versions(id) DEFERRABLE;

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_published_version_id_fkey FOREIGN KEY (published_version_id) REFERENCES public.problem_versions(id) DEFERRABLE;

ALTER TABLE ONLY public.question_drafts
    ADD CONSTRAINT question_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.quota_overrides
    ADD CONSTRAINT quota_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.runner_job_input_cases
    ADD CONSTRAINT runner_job_input_cases_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_job_input_cases
    ADD CONSTRAINT runner_job_input_cases_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.runner_job_inputs(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_job_input_digests
    ADD CONSTRAINT runner_job_input_digests_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.runner_job_inputs(job_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.execution_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_metadata_hash_fkey FOREIGN KEY (metadata_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_session_id_fixture_id_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.runner_snapshot_inputs(session_id, fixture_id);

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_source_hash_fkey FOREIGN KEY (source_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_job_inputs
    ADD CONSTRAINT runner_job_inputs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.runner_version_inputs(version_id) DEFERRABLE;

ALTER TABLE ONLY public.runner_snapshot_input_cases
    ADD CONSTRAINT runner_snapshot_input_cases_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_snapshot_input_cases
    ADD CONSTRAINT runner_snapshot_input_cases_session_id_fixture_id_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.runner_snapshot_inputs(session_id, fixture_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_snapshot_inputs
    ADD CONSTRAINT runner_snapshot_inputs_metadata_hash_fkey FOREIGN KEY (metadata_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_snapshot_inputs
    ADD CONSTRAINT runner_snapshot_inputs_session_id_fixture_id_fkey FOREIGN KEY (session_id, fixture_id) REFERENCES public.interview_question_snapshots(session_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_version_input_cases
    ADD CONSTRAINT runner_version_input_cases_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_version_input_cases
    ADD CONSTRAINT runner_version_input_cases_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.runner_version_inputs(version_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.runner_version_inputs
    ADD CONSTRAINT runner_version_inputs_metadata_hash_fkey FOREIGN KEY (metadata_hash) REFERENCES public.runner_input_blobs(hash);

ALTER TABLE ONLY public.runner_version_inputs
    ADD CONSTRAINT runner_version_inputs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submission_interview_execution_fkey FOREIGN KEY (id, interview_id) REFERENCES public.interview_execution(submission_id, session_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.submission_outbox
    ADD CONSTRAINT submission_outbox_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_public_case_statuses
    ADD CONSTRAINT submission_public_case_statuses_submission_id_channel_ord_fkey FOREIGN KEY (submission_id, channel, ordinal) REFERENCES public.submission_public_result_cases(submission_id, channel, ordinal) ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_public_result_cases
    ADD CONSTRAINT submission_public_result_cases_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_result_header_fields
    ADD CONSTRAINT submission_result_header_fields_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.submission_result_headers
    ADD CONSTRAINT submission_result_headers_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.team_document_presence
    ADD CONSTRAINT team_document_presence_match_id_team_fkey FOREIGN KEY (match_id, team) REFERENCES public.match_teams(match_id, team) ON DELETE CASCADE;

ALTER TABLE ONLY public.team_document_presence
    ADD CONSTRAINT team_document_presence_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.team_document_updates
    ADD CONSTRAINT team_document_updates_match_id_team_fkey FOREIGN KEY (match_id, team) REFERENCES public.match_teams(match_id, team) ON DELETE CASCADE;

ALTER TABLE ONLY public.team_votes
    ADD CONSTRAINT team_votes_match_id_team_fkey FOREIGN KEY (match_id, team) REFERENCES public.match_teams(match_id, team) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspace_problem_version_fkey FOREIGN KEY (problem_version_id) REFERENCES public.problem_versions(id) DEFERRABLE;

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_review_match_id_fkey FOREIGN KEY (review_match_id) REFERENCES public.matches(id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_review_source_owner_id_fkey FOREIGN KEY (review_source_owner_id) REFERENCES public.users(id);

REVOKE ALL ON public.execution_attempt_inventory, public.stage_genesis FROM PUBLIC;
INSERT INTO public.runner_input_gc_state(id) VALUES (1);

SET LOCAL check_function_bodies = DEFAULT;
