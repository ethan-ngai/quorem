-- Published edits replace the row under the same ID. Keep recommendation children
-- until the transaction either restores that ID or performs a permanent deletion.
ALTER TABLE question_exposure DROP CONSTRAINT question_exposure_version_id_fkey,
 ADD CONSTRAINT question_exposure_version_id_fkey FOREIGN KEY(version_id) REFERENCES problem_versions(id) DEFERRABLE;
ALTER TABLE question_learning_events DROP CONSTRAINT question_learning_events_version_id_fkey,
 ADD CONSTRAINT question_learning_events_version_id_fkey FOREIGN KEY(version_id) REFERENCES problem_versions(id) DEFERRABLE;
ALTER TABLE question_embeddings DROP CONSTRAINT question_embeddings_version_id_fkey,
 ADD CONSTRAINT question_embeddings_version_id_fkey FOREIGN KEY(version_id) REFERENCES problem_versions(id) DEFERRABLE;
ALTER TABLE recommendation_impressions DROP CONSTRAINT recommendation_impressions_version_id_fkey,
 ADD CONSTRAINT recommendation_impressions_version_id_fkey FOREIGN KEY(version_id) REFERENCES problem_versions(id) DEFERRABLE;

CREATE FUNCTION delete_question_recommendation_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('quorem.question_replacement',true) IS DISTINCT FROM OLD.id::text THEN
  DELETE FROM recommendation_impressions WHERE version_id=OLD.id;
  DELETE FROM question_learning_events WHERE version_id=OLD.id;
  DELETE FROM question_exposure WHERE version_id=OLD.id;
  DELETE FROM question_embeddings WHERE version_id=OLD.id;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER delete_question_recommendation_data BEFORE DELETE ON problem_versions
 FOR EACH ROW EXECUTE FUNCTION delete_question_recommendation_data();

-- Keep the last successfully generated vector for each question and encoder.
DELETE FROM question_embeddings b USING question_embeddings newer
 WHERE b.version_id=newer.version_id AND b.encoder=newer.encoder
 AND (b.created_at,b.content_key)<(newer.created_at,newer.content_key);
DROP INDEX question_embeddings_lookup;
ALTER TABLE question_embeddings DROP CONSTRAINT question_embeddings_pkey,
 ADD PRIMARY KEY(version_id,encoder);
CREATE INDEX recommendation_impressions_version ON recommendation_impressions(version_id);
CREATE INDEX question_learning_events_version ON question_learning_events(version_id);
CREATE INDEX question_exposure_version ON question_exposure(version_id);

DROP VIEW question_learning_observations;
ALTER TABLE question_learning_events DROP COLUMN content_key;
CREATE VIEW question_learning_observations AS
 SELECT e.*,date_bin(interval '2 hours',e.observed_at,timestamptz '2000-01-01 UTC')+interval '2 hours' AS session_end
 FROM question_learning_events e
 WHERE e.observed_at >= date_bin(interval '2 hours',statement_timestamp(),timestamptz '2000-01-01 UTC')-interval '4320 hours'+interval '2 hours'
   AND e.observed_at < date_bin(interval '2 hours',statement_timestamp(),timestamptz '2000-01-01 UTC');

CREATE OR REPLACE FUNCTION observe_question_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 question record;
 verdict text := NEW.result->>'verdict';
BEGIN
 IF NEW.state<>'completed' OR OLD.state='completed' OR NEW.kind<>'submit'
  OR NEW.custom_run OR NEW.interview_id IS NOT NULL OR verdict IS NULL
  OR verdict NOT IN ('accepted','wrong_answer','time_limit','runtime_error','memory_limit') THEN
  RETURN NEW;
 END IF;
 SELECT v.id,v.difficulty INTO question FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id
 WHERE w.id=NEW.workspace_id AND w.kind IN ('solo','match')
 AND (NEW.odyssey_level IS NULL OR NEW.odyssey_level=jsonb_array_length(v.odyssey->'levels'));
 IF question.id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO question_learning_events(submission_id,owner_id,version_id,difficulty,tags,accepted,context,attempted_at)
 VALUES(NEW.id,NEW.owner_id,question.id,question.difficulty,
  ARRAY(SELECT tag FROM problem_tags WHERE version_id=question.id ORDER BY ordinal),verdict='accepted',
  CASE WHEN NEW.match_id IS NOT NULL THEN 'match' ELSE 'practice' END,NEW.admitted_at)
 ON CONFLICT DO NOTHING;
 INSERT INTO question_exposure(owner_id,version_id,last_seen_at) VALUES(NEW.owner_id,question.id,clock_timestamp())
 ON CONFLICT(owner_id,version_id) DO UPDATE SET last_seen_at=GREATEST(question_exposure.last_seen_at,EXCLUDED.last_seen_at);
 RETURN NEW;
END $$;
