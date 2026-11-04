-- Publication replacement keeps the same version and language keys at commit.
ALTER TABLE workspaces ALTER CONSTRAINT workspace_problem_language_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE matches ALTER CONSTRAINT matches_problem_version_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE matches ALTER CONSTRAINT matches_selected_problem_version_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE question_drafts ALTER CONSTRAINT question_drafts_published_version_id_fkey DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION guard_sealed_problem_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.sealed AND current_setting('quorem.question_mutation',true) IS DISTINCT FROM OLD.id::text THEN
  RAISE EXCEPTION 'Use the question authoring operation to delete a published version' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
