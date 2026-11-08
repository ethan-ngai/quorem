CREATE FUNCTION guard_question_version_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM problems WHERE id=NEW.problem_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM problem_versions WHERE problem_id=NEW.problem_id AND sealed)
   AND NOT (
     current_setting('quorem.question_replacement',true) IS NOT DISTINCT FROM NEW.id::text
     AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM NEW.id::text
   ) THEN
  RAISE EXCEPTION 'Question already has a published identity' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_question_version_insert BEFORE INSERT ON problem_versions
 FOR EACH ROW EXECUTE FUNCTION guard_question_version_insert();
