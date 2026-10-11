ALTER TABLE users ADD COLUMN participant_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
UPDATE users SET participant_id='00000000-0000-4000-8000-000000000001' WHERE id='alice';
UPDATE users SET participant_id='00000000-0000-4000-8000-000000000002' WHERE id='bob';
CREATE TABLE matches (
 id uuid PRIMARY KEY, host_owner_id text NOT NULL REFERENCES users(id),
 invite_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 difficulty text NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
 duration_minutes integer NOT NULL CHECK(duration_minutes IN (15,30,45,60)),
 state text NOT NULL CHECK(state IN ('waiting','ready','active','finalizing','completed','cancelled')),
 version bigint NOT NULL DEFAULT 0, admission_sequence bigint NOT NULL DEFAULT 0,
 problem_version_id uuid REFERENCES problem_versions(id),
 started_at timestamptz, deadline timestamptz, finalizing_at timestamptz, outcome jsonb,
 CHECK((started_at IS NULL)=(problem_version_id IS NULL)),
 CHECK((state IN ('completed','cancelled'))=(outcome IS NOT NULL))
);
CREATE TABLE match_participants (
 match_id uuid NOT NULL REFERENCES matches(id), owner_id text NOT NULL REFERENCES users(id),
 seat integer NOT NULL CHECK(seat IN (1,2)), ready boolean NOT NULL DEFAULT false,
 presence text NOT NULL DEFAULT 'offline' CHECK(presence IN ('online','offline')),
 workspace_id uuid REFERENCES workspaces(id), best_passed integer NOT NULL DEFAULT 0,
 submission_state text, PRIMARY KEY(match_id,owner_id), UNIQUE(match_id,seat)
);
CREATE TABLE match_reservations (
 owner_id text PRIMARY KEY REFERENCES users(id), match_id uuid NOT NULL REFERENCES matches(id)
);
CREATE TABLE match_idempotency (
 owner_id text NOT NULL REFERENCES users(id), route text NOT NULL, key text NOT NULL,
 body_hash text NOT NULL, response jsonb NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,route,key)
);
CREATE TABLE match_outbox (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL UNIQUE,
 match_id uuid NOT NULL REFERENCES matches(id), version bigint NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('match.updated','match.completed')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(match_id,version)
);
CREATE INDEX matches_reconcile ON matches(state,deadline,expires_at) WHERE state NOT IN ('completed','cancelled');
ALTER TABLE workspaces DROP CONSTRAINT workspaces_kind_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_kind_check CHECK(kind IN ('solo','match'));
ALTER TABLE workspaces DROP CONSTRAINT workspaces_owner_id_problem_version_id_language_key;
CREATE UNIQUE INDEX solo_workspace ON workspaces(owner_id,problem_version_id,language) WHERE kind='solo';
ALTER TABLE workspaces ADD COLUMN match_id uuid REFERENCES matches(id);
ALTER TABLE workspaces ADD CONSTRAINT workspace_match_kind CHECK((kind='match')=(match_id IS NOT NULL));
CREATE UNIQUE INDEX match_workspace_owner ON workspaces(match_id,owner_id) WHERE kind='match';
ALTER TABLE submissions ADD COLUMN match_id uuid REFERENCES matches(id);
ALTER TABLE submissions ADD COLUMN match_sequence bigint;
CREATE UNIQUE INDEX match_submission_order ON submissions(match_id,match_sequence) WHERE match_sequence IS NOT NULL;
