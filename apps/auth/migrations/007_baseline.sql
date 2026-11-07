-- Fresh quorem_auth schema through the archived migration history.

SET LOCAL check_function_bodies = false;

CREATE TABLE quorem_auth.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE quorem_auth.jwks (
    id text NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    alg text,
    crv text
);

CREATE TABLE quorem_auth.mail_intent (
    id text NOT NULL,
    purpose text NOT NULL,
    recipient_key text NOT NULL,
    generation integer NOT NULL,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    budget_reservations jsonb NOT NULL,
    registration_token_hash text,
    registration_previous jsonb,
    state text NOT NULL,
    claim_id text,
    claim_until timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_intent_generation_check CHECK ((generation > 0)),
    CONSTRAINT mail_intent_purpose_check CHECK ((purpose = ANY (ARRAY['registration'::text, 'account'::text]))),
    CONSTRAINT mail_intent_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'sending'::text, 'accepted'::text, 'rejected'::text, 'uncertain'::text, 'cancelled'::text])))
);

CREATE TABLE quorem_auth.passkey (
    id text NOT NULL,
    name text,
    "publicKey" text NOT NULL,
    "userId" text NOT NULL,
    "credentialID" text NOT NULL,
    counter bigint NOT NULL,
    "deviceType" text NOT NULL,
    "backedUp" boolean NOT NULL,
    transports text,
    "createdAt" timestamp with time zone,
    aaguid text
);

CREATE TABLE quorem_auth.profile_mutation_lease (
    id text NOT NULL,
    owner_hash text NOT NULL,
    generation text NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE quorem_auth.profile_mutation_window (
    owner_hash text NOT NULL,
    used integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT profile_mutation_window_used_check CHECK (((used >= 1) AND (used <= 10)))
);

CREATE TABLE quorem_auth.rate_limit (
    bucket text NOT NULL,
    used integer NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE quorem_auth.registration_email (
    email text NOT NULL,
    token_hash text,
    grant_hash text,
    expires_at timestamp with time zone NOT NULL,
    last_sent_at timestamp with time zone NOT NULL
);

CREATE TABLE quorem_auth.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);

CREATE TABLE quorem_auth.session_assurance (
    session_id text NOT NULL,
    strong_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE quorem_auth.social_email (
    proof_hash text NOT NULL,
    provider text NOT NULL,
    account_id text NOT NULL,
    email text,
    token_hash text,
    linking boolean DEFAULT false NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE quorem_auth."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    username text,
    "displayUsername" text,
    profile_color integer DEFAULT ((floor((random() * (24)::double precision)))::integer + 1) NOT NULL,
    profile_color_revision bigint DEFAULT (floor((EXTRACT(epoch FROM clock_timestamp()) * (1000)::numeric)))::bigint NOT NULL,
    CONSTRAINT user_profile_color_check CHECK (((profile_color >= 1) AND (profile_color <= 24)))
);

CREATE TABLE quorem_auth.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone
);

ALTER TABLE ONLY quorem_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.account
    ADD CONSTRAINT "account_providerId_accountId_key" UNIQUE ("providerId", "accountId");

ALTER TABLE ONLY quorem_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.mail_intent
    ADD CONSTRAINT mail_intent_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.mail_intent
    ADD CONSTRAINT mail_intent_purpose_recipient_key_generation_key UNIQUE (purpose, recipient_key, generation);

ALTER TABLE ONLY quorem_auth.passkey
    ADD CONSTRAINT "passkey_credentialID_key" UNIQUE ("credentialID");

ALTER TABLE ONLY quorem_auth.passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.profile_mutation_lease
    ADD CONSTRAINT profile_mutation_lease_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.profile_mutation_window
    ADD CONSTRAINT profile_mutation_window_pkey PRIMARY KEY (owner_hash);

ALTER TABLE ONLY quorem_auth.rate_limit
    ADD CONSTRAINT rate_limit_pkey PRIMARY KEY (bucket);

ALTER TABLE ONLY quorem_auth.registration_email
    ADD CONSTRAINT registration_email_grant_hash_key UNIQUE (grant_hash);

ALTER TABLE ONLY quorem_auth.registration_email
    ADD CONSTRAINT registration_email_pkey PRIMARY KEY (email);

ALTER TABLE ONLY quorem_auth.registration_email
    ADD CONSTRAINT registration_email_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY quorem_auth.session_assurance
    ADD CONSTRAINT session_assurance_pkey PRIMARY KEY (session_id);

ALTER TABLE ONLY quorem_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);

ALTER TABLE ONLY quorem_auth.social_email
    ADD CONSTRAINT social_email_pkey PRIMARY KEY (proof_hash);

ALTER TABLE ONLY quorem_auth.social_email
    ADD CONSTRAINT social_email_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY quorem_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);

ALTER TABLE ONLY quorem_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quorem_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

CREATE INDEX auth_account_user ON quorem_auth.account USING btree ("userId");

CREATE INDEX auth_passkey_user ON quorem_auth.passkey USING btree ("userId");

CREATE INDEX auth_session_user ON quorem_auth.session USING btree ("userId");

CREATE UNIQUE INDEX auth_username_unique ON quorem_auth."user" USING btree (username) WHERE (username IS NOT NULL);

CREATE INDEX auth_verification_identifier ON quorem_auth.verification USING btree (identifier);

CREATE INDEX mail_intent_expiry ON quorem_auth.mail_intent USING btree (expires_at);

CREATE INDEX profile_mutation_window_expiry ON quorem_auth.profile_mutation_window USING btree (expires_at);

CREATE INDEX rate_limit_expiry ON quorem_auth.rate_limit USING btree (expires_at);

CREATE INDEX registration_email_expiry ON quorem_auth.registration_email USING btree (expires_at);

CREATE INDEX social_email_expiry ON quorem_auth.social_email USING btree (expires_at);

CREATE INDEX social_email_identity ON quorem_auth.social_email USING btree (provider, account_id);

ALTER TABLE ONLY quorem_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.passkey
    ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.session_assurance
    ADD CONSTRAINT session_assurance_session_id_fkey FOREIGN KEY (session_id) REFERENCES quorem_auth.session(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;

SET LOCAL check_function_bodies = DEFAULT;
