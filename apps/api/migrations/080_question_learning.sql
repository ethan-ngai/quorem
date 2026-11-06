-- Durable learning metadata; ordinary submission expiry does not remove observations.
CREATE TABLE question_exposure (
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 last_seen_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,version_id)
);
CREATE FUNCTION observe_question_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind IN ('solo','match') AND NEW.problem_version_id IS NOT NULL THEN
  INSERT INTO question_exposure(owner_id,version_id,last_seen_at)
  VALUES(NEW.owner_id,NEW.problem_version_id,clock_timestamp())
  ON CONFLICT(owner_id,version_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER question_workspace_observed AFTER INSERT ON workspaces
 FOR EACH ROW EXECUTE FUNCTION observe_question_workspace();
-- Backfill exposure only: expired outcomes and historical content cannot be reconstructed.
INSERT INTO question_exposure(owner_id,version_id,last_seen_at)
SELECT owner_id,problem_version_id,max(updated_at) FROM workspaces
WHERE kind IN ('solo','match') AND problem_version_id IS NOT NULL
GROUP BY owner_id,problem_version_id;

CREATE FUNCTION recommendation_content_key(version_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT v.id::text||':'||md5(jsonb_build_array(v.title,v.statement_markdown,v.difficulty,
  (SELECT jsonb_agg(tag ORDER BY ordinal) FROM problem_tags WHERE problem_tags.version_id=v.id))::text)
 FROM problem_versions v WHERE v.id=recommendation_content_key.version_id
$$;
CREATE TABLE question_learning_events (
 submission_id uuid PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 content_key text NOT NULL,
 difficulty text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
 tags text[] NOT NULL,
 accepted boolean NOT NULL,
 context text NOT NULL CHECK (context IN ('practice','match')),
 attempted_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX learning_events_owner_time ON question_learning_events(owner_id,observed_at,submission_id);
CREATE INDEX learning_events_retention ON question_learning_events(observed_at,submission_id);
CREATE INDEX learning_events_content ON question_learning_events(content_key);
CREATE TABLE question_embeddings (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 content_key text NOT NULL,
 encoder text NOT NULL,
 embedding real[] NOT NULL CHECK (array_length(embedding,1)=384),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(version_id,content_key,encoder)
);
CREATE INDEX question_embeddings_lookup ON question_embeddings(encoder,content_key);
CREATE TABLE recommendation_models (
 id uuid PRIMARY KEY,
 model jsonb NOT NULL CHECK (jsonb_typeof(model)='object'),
 report jsonb NOT NULL CHECK (jsonb_typeof(report)='object'),
 active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 days'
);
CREATE UNIQUE INDEX recommendation_active_model ON recommendation_models(active) WHERE active;
CREATE FUNCTION observe_question_result() RETURNS trigger LANGUAGE plpgsql AS $$
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
 INSERT INTO question_learning_events(submission_id,owner_id,version_id,content_key,difficulty,tags,accepted,context,attempted_at)
 VALUES(NEW.id,NEW.owner_id,question.id,recommendation_content_key(question.id),question.difficulty,
  ARRAY(SELECT tag FROM problem_tags WHERE version_id=question.id ORDER BY ordinal),verdict='accepted',
  CASE WHEN NEW.match_id IS NOT NULL THEN 'match' ELSE 'practice' END,NEW.admitted_at)
 ON CONFLICT DO NOTHING;
 INSERT INTO question_exposure(owner_id,version_id,last_seen_at) VALUES(NEW.owner_id,question.id,clock_timestamp())
 ON CONFLICT(owner_id,version_id) DO UPDATE SET last_seen_at=GREATEST(question_exposure.last_seen_at,EXCLUDED.last_seen_at);
 RETURN NEW;
END $$;
CREATE TRIGGER question_result_observed AFTER UPDATE OF state ON submissions
 FOR EACH ROW EXECUTE FUNCTION observe_question_result();
