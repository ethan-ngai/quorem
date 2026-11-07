-- Fresh preproduction baseline. Changes after this baseline use new migrations.



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
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT account_pkey PRIMARY KEY (id),
    CONSTRAINT "account_providerId_accountId_key" UNIQUE ("providerId", "accountId")
);

CREATE TABLE quorem_auth.jwks (
    id text NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    alg text,
    crv text,
    CONSTRAINT jwks_pkey PRIMARY KEY (id)
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
    aaguid text,
    CONSTRAINT "passkey_credentialID_key" UNIQUE ("credentialID"),
    CONSTRAINT passkey_pkey PRIMARY KEY (id)
);

CREATE TABLE quorem_auth.rate_limit (
    bucket text NOT NULL,
    used integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT rate_limit_pkey PRIMARY KEY (bucket)
);

CREATE TABLE quorem_auth.registration_email (
    email text NOT NULL,
    token_hash text,
    grant_hash text,
    expires_at timestamp with time zone NOT NULL,
    last_sent_at timestamp with time zone NOT NULL,
    CONSTRAINT registration_email_grant_hash_key UNIQUE (grant_hash),
    CONSTRAINT registration_email_pkey PRIMARY KEY (email),
    CONSTRAINT registration_email_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE quorem_auth.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL,
    CONSTRAINT session_pkey PRIMARY KEY (id),
    CONSTRAINT session_token_key UNIQUE (token)
);

CREATE TABLE quorem_auth.session_assurance (
    session_id text NOT NULL,
    strong_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT session_assurance_pkey PRIMARY KEY (session_id)
);

CREATE TABLE quorem_auth.social_email (
    proof_hash text NOT NULL,
    provider text NOT NULL,
    account_id text NOT NULL,
    email text,
    token_hash text,
    linking boolean DEFAULT false NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT social_email_pkey PRIMARY KEY (proof_hash),
    CONSTRAINT social_email_token_hash_key UNIQUE (token_hash)
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
    "displayUsername" text
);

CREATE TABLE quorem_auth.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    CONSTRAINT verification_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY quorem_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);

ALTER TABLE ONLY quorem_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);

CREATE INDEX auth_passkey_user ON quorem_auth.passkey USING btree ("userId");

CREATE INDEX auth_session_user ON quorem_auth.session USING btree ("userId");

CREATE UNIQUE INDEX auth_username_unique ON quorem_auth."user" USING btree (username) WHERE (username IS NOT NULL);

CREATE INDEX auth_verification_identifier ON quorem_auth.verification USING btree (identifier);

CREATE INDEX rate_limit_expiry ON quorem_auth.rate_limit USING btree (expires_at);

CREATE INDEX registration_email_expiry ON quorem_auth.registration_email USING btree (expires_at);

CREATE INDEX social_email_identity ON quorem_auth.social_email USING btree (provider, account_id);

ALTER TABLE ONLY quorem_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.passkey
    ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.session_assurance
    ADD CONSTRAINT session_assurance_session_id_fkey FOREIGN KEY (session_id) REFERENCES quorem_auth.session(id) ON DELETE CASCADE;

ALTER TABLE ONLY quorem_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES quorem_auth."user"(id) ON DELETE CASCADE;
