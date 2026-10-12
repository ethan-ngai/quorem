-- Bootstrap imports remain open until language/editorial records have been registered.
ALTER TABLE problem_versions ADD COLUMN sealed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION immutable_problem_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF NOT OLD.sealed AND NEW.sealed AND
     (to_jsonb(NEW)-'sealed')=(to_jsonb(OLD)-'sealed') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Published problem content is immutable; create a new version' USING ERRCODE='23514';
END $$;

CREATE FUNCTION guard_sealed_problem_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed boolean; identical boolean; target uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN target:=OLD.version_id; ELSE target:=NEW.version_id; END IF;
 -- Serialize registration against sealing; no child can slip past a concurrent seal.
 SELECT sealed INTO closed FROM problem_versions WHERE id=target FOR SHARE;
 IF COALESCE(closed,false) THEN
  IF TG_OP='INSERT' THEN
   -- BEFORE INSERT also runs for ON CONFLICT; permit exact seed replay only.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I t WHERE to_jsonb(t)=$1)',TG_TABLE_SCHEMA,TG_TABLE_NAME)
    INTO identical USING to_jsonb(NEW);
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
END $$;
CREATE TRIGGER sealed_problem_language BEFORE INSERT OR UPDATE OR DELETE ON problem_languages FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();
CREATE TRIGGER sealed_problem_example BEFORE INSERT OR UPDATE OR DELETE ON problem_examples FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();
CREATE TRIGGER sealed_problem_case BEFORE INSERT OR UPDATE OR DELETE ON problem_test_cases FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();
CREATE TRIGGER sealed_problem_tag BEFORE INSERT OR UPDATE OR DELETE ON problem_tags FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();
CREATE TRIGGER sealed_problem_solution BEFORE INSERT OR UPDATE OR DELETE ON problem_solutions FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE FUNCTION guard_sealed_problem_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.sealed THEN RAISE EXCEPTION 'Sealed problem versions cannot be deleted' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER sealed_problem_delete BEFORE DELETE ON problem_versions FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_delete();
