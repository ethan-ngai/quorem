-- Fixed windows keep retries together and provide immutable time boundaries for replay.
ALTER TABLE question_learning_events ADD COLUMN assisted boolean NOT NULL DEFAULT false;
CREATE VIEW question_learning_observations AS
 SELECT e.*,date_bin(interval '2 hours',e.observed_at,timestamptz '2000-01-01 UTC')+interval '2 hours' AS session_end
 FROM question_learning_events e
 WHERE e.observed_at >= date_bin(interval '2 hours',statement_timestamp(),timestamptz '2000-01-01 UTC')-interval '4320 hours'+interval '2 hours'
   AND e.observed_at < date_bin(interval '2 hours',statement_timestamp(),timestamptz '2000-01-01 UTC');

DROP TRIGGER question_workspace_observed ON workspaces;
CREATE TRIGGER question_workspace_observed AFTER INSERT OR UPDATE OF owner_id ON workspaces
 FOR EACH ROW EXECUTE FUNCTION observe_question_workspace();

ALTER TABLE question_exposure ADD COLUMN assisted_at timestamptz;
CREATE FUNCTION mark_learning_assistance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.assisted := EXISTS (
  SELECT 1 FROM question_exposure x WHERE x.owner_id=NEW.owner_id AND x.version_id=NEW.version_id
   AND x.assisted_at BETWEEN NEW.attempted_at-interval '1 day' AND NEW.attempted_at
 ) OR (NEW.context='match' AND EXISTS (
  SELECT 1 FROM submissions s JOIN match_participants p ON p.match_id=s.match_id AND p.owner_id=NEW.owner_id
  JOIN match_rule_events r ON r.match_id=p.match_id AND r.competitor_id=COALESCE(p.competitor_id,p.owner_id)
  WHERE s.id=NEW.submission_id AND r.kind IN ('hiddenCase','topics','complexity')
    AND r.resource_key IS NOT NULL AND r.occurred_at<=NEW.attempted_at
 ));
 RETURN NEW;
END $$;
CREATE TRIGGER question_learning_assistance BEFORE INSERT ON question_learning_events
 FOR EACH ROW WHEN (NOT NEW.assisted) EXECUTE FUNCTION mark_learning_assistance();

CREATE TABLE recommendation_impressions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 model_id uuid,
 variant text NOT NULL CHECK (variant IN ('control','explore')),
 position integer NOT NULL CHECK (position>0),
 served_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 viewed_at timestamptz,
 started_at timestamptz,
 dismissed_at timestamptz,
 first_outcome_at timestamptz,
 solved_at timestamptz,
 followup_solved boolean,
 UNIQUE NULLS NOT DISTINCT(owner_id,version_id,variant,model_id,served_at)
);
CREATE INDEX recommendation_impressions_owner_question ON recommendation_impressions(owner_id,version_id,served_at DESC);
CREATE INDEX recommendation_impressions_retention ON recommendation_impressions(served_at);

CREATE FUNCTION attribute_recommendation_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.context='practice' THEN
  UPDATE recommendation_impressions SET
   first_outcome_at=COALESCE(first_outcome_at,NEW.observed_at),
   solved_at=CASE WHEN NEW.accepted THEN COALESCE(solved_at,NEW.observed_at) ELSE solved_at END
  WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND version_id=NEW.version_id AND started_at<=NEW.attempted_at
      AND started_at>=NEW.attempted_at-interval '2 hours'
    ORDER BY started_at DESC,id LIMIT 1);
  -- The first independent return in the measurement window is the delayed outcome.
  IF NOT NEW.assisted THEN
   UPDATE recommendation_impressions SET followup_solved=NEW.accepted
   WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND version_id=NEW.version_id
      AND solved_at BETWEEN NEW.attempted_at-interval '14 days' AND NEW.attempted_at-interval '2 days'
    ORDER BY solved_at DESC,id LIMIT 1)
    AND followup_solved IS NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recommendation_outcome AFTER INSERT ON question_learning_events
 FOR EACH ROW EXECUTE FUNCTION attribute_recommendation_outcome();

CREATE FUNCTION attribute_recommendation_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='solo' THEN
  UPDATE recommendation_impressions SET started_at=clock_timestamp()
  WHERE id=(SELECT id FROM recommendation_impressions
    WHERE owner_id=NEW.owner_id AND version_id=NEW.problem_version_id
      AND viewed_at IS NOT NULL AND dismissed_at IS NULL
      AND served_at>=statement_timestamp()-interval '2 hours'
    ORDER BY served_at DESC,id LIMIT 1)
    AND started_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
-- Match the result trigger lock order: impression, then exposure.
CREATE TRIGGER observe_recommendation_start AFTER INSERT OR UPDATE OF owner_id ON workspaces
 FOR EACH ROW EXECUTE FUNCTION attribute_recommendation_start();

CREATE TABLE recommendation_match_selections (
 match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
 model_id uuid,
 mean_success real NOT NULL,
 success_spread real NOT NULL,
 familiarity_gap integer NOT NULL,
 selected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX recommendation_match_retention ON recommendation_match_selections(selected_at);
