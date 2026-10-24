ALTER TABLE workspaces ADD COLUMN odyssey_scope uuid;
ALTER TABLE submissions ADD COLUMN odyssey_level integer;
CREATE TABLE odyssey_progress (
 scope_id uuid NOT NULL,
 problem_version_id uuid NOT NULL,
 level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 8),
 completed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(scope_id,problem_version_id)
);
