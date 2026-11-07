CREATE TABLE quorem_auth.mail_intent (
    id text PRIMARY KEY,
    purpose text NOT NULL CHECK (purpose IN ('registration', 'account')),
    recipient_key text NOT NULL,
    generation integer NOT NULL CHECK (generation > 0),
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    budget_reservations jsonb NOT NULL,
    registration_token_hash text,
    registration_previous jsonb,
    state text NOT NULL CHECK (state IN ('pending', 'sending', 'accepted', 'rejected', 'uncertain', 'cancelled')),
    claim_id text,
    claim_until timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (purpose, recipient_key, generation)
);
CREATE INDEX mail_intent_expiry ON quorem_auth.mail_intent (expires_at);
