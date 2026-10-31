CREATE TABLE quorem_auth.profile_mutation_window (
    owner_hash text PRIMARY KEY,
    used integer NOT NULL CHECK (used >= 1 AND used <= 10),
    expires_at timestamptz NOT NULL
);
CREATE INDEX profile_mutation_window_expiry ON quorem_auth.profile_mutation_window (expires_at);

CREATE TABLE quorem_auth.profile_mutation_lease (
    id text PRIMARY KEY,
    owner_hash text NOT NULL,
    generation text NOT NULL,
    deadline_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
