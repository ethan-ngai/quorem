-- JSONB text adds structural spaces; wire payloads remain capped at 2 MiB.
CREATE TABLE question_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=4194304),
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 published_version_id uuid REFERENCES problem_versions(id)
);
CREATE INDEX question_drafts_updated_at ON question_drafts(updated_at DESC,id);
CREATE INDEX question_drafts_created_by ON question_drafts(created_by);
CREATE INDEX question_drafts_updated_by ON question_drafts(updated_by);
CREATE INDEX question_drafts_published_version ON question_drafts(published_version_id);
