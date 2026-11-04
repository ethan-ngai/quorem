ALTER TABLE workspaces ALTER COLUMN problem_version_id DROP NOT NULL;
ALTER TABLE matches DROP CONSTRAINT matches_check;
ALTER TABLE matches ADD CONSTRAINT matches_check CHECK (
 (started_at IS NULL AND problem_version_id IS NULL)
 OR (started_at IS NOT NULL AND (problem_version_id IS NOT NULL OR state IN ('completed','cancelled')))
);

CREATE OR REPLACE FUNCTION guard_workspace_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.owner_id,NEW.problem_version_id,NEW.language,NEW.kind,NEW.match_id)
    IS DISTINCT FROM (OLD.owner_id,OLD.problem_version_id,OLD.language,OLD.kind,OLD.match_id)
    AND NOT (
      NEW.problem_version_id IS NULL AND OLD.problem_version_id IS NOT NULL
      AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM OLD.problem_version_id::text
      AND (NEW.owner_id,NEW.language,NEW.kind,NEW.match_id)
        IS NOT DISTINCT FROM (OLD.owner_id,OLD.language,OLD.kind,OLD.match_id)
    ) THEN
  RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE question_drafts ADD COLUMN edit_version_id uuid CONSTRAINT question_drafts_edit_version_fkey REFERENCES problem_versions(id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE question_drafts ADD COLUMN edit_base text;
CREATE UNIQUE INDEX question_drafts_edit_version ON question_drafts(edit_version_id) WHERE edit_version_id IS NOT NULL;
