ALTER TABLE matches ADD COLUMN question_selection text NOT NULL DEFAULT 'random'
 CHECK (question_selection IN ('random', 'recommended'));

CREATE OR REPLACE FUNCTION delete_question_recommendation_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('quorem.question_replacement',true) IS DISTINCT FROM OLD.id::text THEN
  DELETE FROM recommendation_impressions WHERE version_id=OLD.id;
  DELETE FROM question_learning_events WHERE version_id=OLD.id;
  DELETE FROM question_exposure WHERE version_id=OLD.id;
 END IF;
 RETURN OLD;
END $$;

DROP TABLE question_embeddings;
DROP FUNCTION recommendation_content_key(uuid);
