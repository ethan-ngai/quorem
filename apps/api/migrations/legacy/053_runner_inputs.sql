-- Immutable shared values; the database verifies content address on every insert.
CREATE TABLE runner_input_blobs (
 hash bytea PRIMARY KEY,
 data bytea NOT NULL,
 CONSTRAINT runner_input_blobs_hash_check CHECK (octet_length(hash)=32 AND hash=sha256(data))
);
CREATE FUNCTION runner_input_blob_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'runner input blobs are immutable';
END $$;
CREATE TRIGGER runner_input_blob_immutable BEFORE UPDATE ON runner_input_blobs FOR EACH ROW EXECUTE FUNCTION runner_input_blob_immutable();

-- Concrete parent FKs prevent a fixture index from outliving or aliasing its owner.
CREATE TABLE runner_version_inputs (
 version_id uuid PRIMARY KEY REFERENCES problem_versions(id) ON DELETE CASCADE,
 metadata_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 fixture_hash bytea NOT NULL CHECK (octet_length(fixture_hash)=32),
 sealed boolean NOT NULL DEFAULT false
);
CREATE TABLE runner_snapshot_inputs (
 session_id uuid NOT NULL,
 fixture_id bytea NOT NULL,
 metadata_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 fixture_hash bytea NOT NULL CHECK (octet_length(fixture_hash)=32),
 sealed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(session_id,fixture_id),
 FOREIGN KEY(session_id,fixture_id) REFERENCES interview_question_snapshots(session_id,id) ON DELETE CASCADE
);
CREATE TABLE runner_version_input_cases (
 version_id uuid NOT NULL REFERENCES runner_version_inputs(version_id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('example','hidden')),
 stage integer NOT NULL CHECK (stage >= 0),
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 blob_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 PRIMARY KEY(version_id,channel,stage,ordinal)
);
CREATE TABLE runner_snapshot_input_cases (
 session_id uuid NOT NULL,
 fixture_id bytea NOT NULL,
 channel text NOT NULL CHECK (channel IN ('example','hidden')),
 stage integer NOT NULL CHECK (stage >= 0),
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 blob_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 PRIMARY KEY(session_id,fixture_id,channel,stage,ordinal),
 FOREIGN KEY(session_id,fixture_id) REFERENCES runner_snapshot_inputs(session_id,fixture_id) ON DELETE CASCADE
);
-- A job pins exactly one concrete fixture until its own retention deletes the job.
CREATE TABLE runner_job_inputs (
 job_id uuid PRIMARY KEY REFERENCES execution_jobs(id) ON DELETE CASCADE,
 version_id uuid REFERENCES runner_version_inputs(version_id),
 session_id uuid,
 fixture_id bytea,
 metadata_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 source_hash bytea NOT NULL REFERENCES runner_input_blobs(hash) CHECK (octet_length(source_hash)=32),
 runtime_revision text NOT NULL,
 harness_revision text NOT NULL,
 case_count integer NOT NULL CHECK (case_count BETWEEN 0 AND 320),
 sample_count integer NOT NULL CHECK (sample_count BETWEEN 0 AND 320),
 private_details boolean NOT NULL,
 submit_cases_are_samples boolean NOT NULL,
 sealed boolean NOT NULL DEFAULT false,
 CHECK (case_count + CASE WHEN submit_cases_are_samples THEN 0 ELSE sample_count END <= 320),
 CHECK (NOT submit_cases_are_samples OR (private_details AND case_count=sample_count)),
 CHECK ((version_id IS NOT NULL AND session_id IS NULL AND fixture_id IS NULL) OR (version_id IS NULL AND session_id IS NOT NULL AND fixture_id IS NOT NULL)),
 FOREIGN KEY(session_id,fixture_id) REFERENCES runner_snapshot_inputs(session_id,fixture_id)
);
CREATE TABLE runner_job_input_cases (
 job_id uuid NOT NULL REFERENCES runner_job_inputs(job_id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
 channel text NOT NULL CHECK (channel IN ('public','sample','private')),
 blob_hash bytea NOT NULL REFERENCES runner_input_blobs(hash),
 PRIMARY KEY(job_id,ordinal)
);
CREATE INDEX runner_version_inputs_metadata_hash_idx ON runner_version_inputs(metadata_hash);
CREATE INDEX runner_snapshot_inputs_metadata_hash_idx ON runner_snapshot_inputs(metadata_hash);
CREATE INDEX runner_version_input_cases_blob_hash_idx ON runner_version_input_cases(blob_hash);
CREATE INDEX runner_snapshot_input_cases_blob_hash_idx ON runner_snapshot_input_cases(blob_hash);
CREATE INDEX runner_job_inputs_metadata_hash_idx ON runner_job_inputs(metadata_hash);
CREATE INDEX runner_job_inputs_source_hash_idx ON runner_job_inputs(source_hash);
CREATE INDEX runner_job_input_cases_blob_hash_idx ON runner_job_input_cases(blob_hash);

-- Publish each index once. Cascaded retention deletes are permitted only after the parent is gone.
CREATE FUNCTION runner_input_index_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER runner_version_input_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON runner_version_input_cases FOR EACH ROW EXECUTE FUNCTION runner_input_index_guard();
CREATE TRIGGER runner_snapshot_input_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON runner_snapshot_input_cases FOR EACH ROW EXECUTE FUNCTION runner_input_index_guard();
CREATE TRIGGER runner_job_input_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON runner_job_input_cases FOR EACH ROW EXECUTE FUNCTION runner_input_index_guard();
CREATE FUNCTION runner_input_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER runner_version_inputs_guard BEFORE INSERT OR UPDATE ON runner_version_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_manifest_guard();
CREATE TRIGGER runner_snapshot_inputs_guard BEFORE INSERT OR UPDATE ON runner_snapshot_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_manifest_guard();
CREATE TRIGGER runner_job_inputs_guard BEFORE INSERT OR UPDATE ON runner_job_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_manifest_guard();
