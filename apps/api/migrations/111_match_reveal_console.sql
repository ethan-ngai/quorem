CREATE OR REPLACE FUNCTION public.runner_input_manifest_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE n integer; v integer; actual_metadata bytea; actual_source bytea; revision text; harness text; actual_publication uuid; actual_session uuid; actual_fixture bytea; retain_private_details boolean;
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
  SELECT sha256(convert_to(s.source,'UTF8')),j.runtime_revision,j.harness_revision,w.publication_id,ie.session_id,ie.fixture_id,
   ie.session_id IS NOT NULL OR (s.kind='submit' AND COALESCE(m.rules->'assistance'->'hiddenCase'->>'access' IN ('free','announce','penalty'),false)) INTO actual_source,revision,harness,actual_publication,actual_session,actual_fixture,retain_private_details FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN matches m ON m.id=s.match_id WHERE j.id=NEW.job_id;
  IF actual_metadata IS DISTINCT FROM NEW.metadata_hash OR actual_source IS DISTINCT FROM NEW.source_hash OR revision IS DISTINCT FROM NEW.runtime_revision OR harness IS DISTINCT FROM NEW.harness_revision OR actual_publication IS DISTINCT FROM NEW.publication_id OR actual_session IS DISTINCT FROM NEW.session_id OR actual_fixture IS DISTINCT FROM NEW.fixture_id OR NEW.private_details IS DISTINCT FROM retain_private_details THEN RAISE EXCEPTION 'invalid job input binding'; END IF;
 END IF;
 RETURN NEW;
END $function$;
