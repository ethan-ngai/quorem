CREATE TABLE interviews (
 id uuid PRIMARY KEY, host_id text NOT NULL REFERENCES users(id), title text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed')),
 question jsonb NOT NULL, language text NOT NULL, source text NOT NULL,
 document_version bigint NOT NULL DEFAULT 0, document_epoch uuid NOT NULL,
 version bigint NOT NULL DEFAULT 1, invite_hash text NOT NULL UNIQUE, invite_token text NOT NULL,
 guest_joins integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE interview_members (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('interviewer','interviewee')), removed_at timestamptz,
 PRIMARY KEY(session_id,user_id)
);
CREATE INDEX interview_members_user ON interview_members(user_id) WHERE removed_at IS NULL;
CREATE TABLE interview_updates (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, epoch uuid NOT NULL,
 version bigint NOT NULL, client_id text NOT NULL, changes jsonb NOT NULL,
 PRIMARY KEY(session_id,epoch,version)
);
CREATE TABLE interview_operations (
 owner_id text NOT NULL REFERENCES users(id), key text NOT NULL, fingerprint text NOT NULL,
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, response jsonb,
 PRIMARY KEY(owner_id,key)
);
CREATE TABLE interview_guest_sessions (
 token_hash text PRIMARY KEY, owner_id text NOT NULL UNIQUE REFERENCES users(id),
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours', revoked_at timestamptz
);
CREATE TABLE interview_execution (
 submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 document_version bigint NOT NULL, document_epoch uuid NOT NULL, fixture jsonb NOT NULL, level integer NOT NULL DEFAULT 1,
 progress_scope uuid
);
CREATE INDEX interview_execution_session ON interview_execution(session_id,submission_id);
CREATE TABLE interview_presence (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id), client_id text NOT NULL,
 epoch uuid NOT NULL, version bigint NOT NULL, anchor integer NOT NULL, head integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(session_id,user_id,client_id)
);
