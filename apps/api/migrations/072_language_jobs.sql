ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_language_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_language_check CHECK (language IN ('python','java','typescript','ocaml'));
ALTER TABLE execution_jobs ADD COLUMN language text NOT NULL DEFAULT 'python';
ALTER TABLE execution_jobs ADD COLUMN runtime_revision text NOT NULL DEFAULT 'python-3.12-v1';
ALTER TABLE execution_jobs ADD COLUMN harness_revision text NOT NULL DEFAULT 'quorem-harness-v2';
