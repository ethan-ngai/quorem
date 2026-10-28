DROP TRIGGER normalize_problem_before ON problem_versions;
DROP TRIGGER normalize_problem_after ON problem_versions;
DROP FUNCTION normalize_problem_insert();
DROP FUNCTION normalize_problem_children();

ALTER TABLE problem_versions DROP CONSTRAINT problem_versions_slug_version_key;
ALTER TABLE problem_versions ADD CONSTRAINT problem_versions_problem_version_key UNIQUE (problem_id,version);
ALTER TABLE problem_versions DROP COLUMN slug, DROP COLUMN public, DROP COLUMN fixture;

DROP TABLE outbox_events;
