CREATE TABLE parties (
 id uuid PRIMARY KEY,
 host_owner_id text NOT NULL REFERENCES users(id),
 invite_hash text NOT NULL UNIQUE,
 settings jsonb NOT NULL,
 version bigint NOT NULL DEFAULT 0,
 current_match_id uuid REFERENCES matches(id),
 latest_match_id uuid REFERENCES matches(id),
 countdown_ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 disbanded_at timestamptz
);
CREATE TABLE party_members (
 party_id uuid NOT NULL REFERENCES parties(id),
 owner_id text NOT NULL REFERENCES users(id),
 seat integer NOT NULL CHECK (seat BETWEEN 1 AND 8),
 ready boolean NOT NULL DEFAULT false,
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (party_id, owner_id),
 UNIQUE (owner_id),
 UNIQUE (party_id, seat)
);
CREATE TABLE platform_presence_leases (
 owner_id text NOT NULL REFERENCES users(id),
 window_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (owner_id, window_id)
);
CREATE INDEX platform_presence_expiry ON platform_presence_leases (expires_at);
CREATE INDEX party_members_last_seen ON party_members (last_seen_at);
CREATE INDEX parties_countdown ON parties (countdown_ends_at) WHERE countdown_ends_at IS NOT NULL;
ALTER TABLE matches ADD COLUMN party_id uuid REFERENCES parties(id);
ALTER TABLE matches ADD COLUMN share_code_after_match boolean NOT NULL DEFAULT false;
ALTER TABLE guest_sessions ADD COLUMN party_id uuid REFERENCES parties(id);
ALTER TABLE matches ADD COLUMN completed_at timestamptz;
UPDATE matches SET completed_at=(outcome->>'completedAt')::timestamptz WHERE outcome->>'completedAt' IS NOT NULL;
ALTER TABLE guest_sessions ALTER COLUMN match_id DROP NOT NULL;
ALTER TABLE guest_sessions ADD CONSTRAINT guest_sessions_scope_check CHECK ((match_id IS NOT NULL) <> (party_id IS NOT NULL));
ALTER TABLE parties ADD COLUMN guest_joins integer NOT NULL DEFAULT 0 CHECK (guest_joins >= 0);
