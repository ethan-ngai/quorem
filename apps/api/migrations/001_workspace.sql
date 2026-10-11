CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, display_name text NOT NULL,
 admission_tokens double precision NOT NULL DEFAULT 2,
 tokens_updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO users(id,display_name) VALUES ('alice','Alice'),('bob','Bob') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS problem_versions (
 id uuid PRIMARY KEY, slug text NOT NULL, version integer NOT NULL,
 public jsonb NOT NULL, fixture jsonb NOT NULL, UNIQUE(slug,version)
);
CREATE TABLE IF NOT EXISTS workspaces (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),
 problem_version_id uuid NOT NULL REFERENCES problem_versions(id), language text NOT NULL CHECK(language='python'),
 kind text NOT NULL DEFAULT 'solo' CHECK(kind='solo'), source text NOT NULL,
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,problem_version_id,language)
);
CREATE TABLE IF NOT EXISTS draft_versions (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 revision bigint NOT NULL, source text NOT NULL, saved_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,revision)
);
CREATE TABLE IF NOT EXISTS draft_sessions (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, sequence numeric(30,0) NOT NULL,
 PRIMARY KEY(workspace_id,session_id)
);
CREATE INDEX IF NOT EXISTS draft_history_time ON draft_versions(saved_at);
