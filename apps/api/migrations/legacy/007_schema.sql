-- Product schema baseline; later changes use new migrations.

CREATE FUNCTION guard_sealed_problem_child() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE closed boolean; identical boolean; target uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN target:=OLD.version_id; ELSE target:=NEW.version_id; END IF;
 -- Serialize registration against sealing; no child can slip past a concurrent seal.
 SELECT sealed INTO closed FROM problem_versions WHERE id=target FOR SHARE;
 IF COALESCE(closed,false) THEN
  IF TG_OP='INSERT' THEN
   -- BEFORE INSERT also runs for ON CONFLICT; permit exact seed replay only.
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I t WHERE t.version_id=$2 AND to_jsonb(t)=$1)',TG_TABLE_SCHEMA,TG_TABLE_NAME)
    INTO identical USING to_jsonb(NEW),NEW.version_id;
   IF identical THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Sealed problem content is immutable; create a new version' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.version_id IS DISTINCT FROM NEW.version_id THEN
  SELECT sealed INTO closed FROM problem_versions WHERE id=OLD.version_id FOR SHARE;
  IF closed THEN RAISE EXCEPTION 'Sealed problem content is immutable; create a new version' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $_$;

CREATE FUNCTION guard_sealed_problem_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.sealed THEN RAISE EXCEPTION 'Sealed problem versions cannot be deleted' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;

CREATE FUNCTION immutable_access_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Access audit is append only'; END $$;

CREATE FUNCTION immutable_problem_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF NOT OLD.sealed AND NEW.sealed AND
     (to_jsonb(NEW)-'sealed')=(to_jsonb(OLD)-'sealed') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Published problem content is immutable; create a new version' USING ERRCODE='23514';
END $$;

CREATE FUNCTION interview_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE session uuid; kind text;
BEGIN
 kind := 'interview.session';
 IF TG_TABLE_NAME='interviews' THEN
  session := NEW.id;
  IF NEW.document_epoch=OLD.document_epoch AND NEW.document_version<>OLD.document_version THEN kind := 'interview.document'; END IF;
 ELSIF TG_TABLE_NAME='submissions' THEN
  kind := 'interview.result';
  SELECT session_id INTO session FROM interview_execution WHERE submission_id=NEW.id;
 ELSE
  IF TG_TABLE_NAME='interview_presence' THEN kind := 'interview.presence'; END IF;
  IF TG_TABLE_NAME='interview_execution' THEN kind := 'interview.result'; END IF;
  IF TG_OP='DELETE' THEN session := OLD.session_id; ELSE session := NEW.session_id; END IF;
 END IF;
 IF session IS NOT NULL THEN
  INSERT INTO interview_outbox(session_id,event_type) SELECT session,kind WHERE EXISTS(SELECT 1 FROM interviews WHERE id=session);
  PERFORM pg_notify('quorem_interview_outbox','');
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION meter_guest_execution() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE elapsed integer; terminal_state text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM guest_execution_usage WHERE submission_id=OLD.submission_id) THEN RETURN NEW; END IF;
 IF OLD.attempt_id IS NOT NULL AND OLD.attempt_started_at IS NOT NULL AND (NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR (NEW.finished AND NOT OLD.finished)) THEN
  elapsed:=LEAST(60,GREATEST(0,CEIL(EXTRACT(EPOCH FROM(clock_timestamp()-OLD.attempt_started_at)))::integer));
  INSERT INTO execution_attempt_usage(attempt_id,submission_id,seconds) VALUES(OLD.attempt_id,OLD.submission_id,elapsed) ON CONFLICT DO NOTHING;
 END IF;
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN NEW.attempt_started_at:=CASE WHEN NEW.attempt_id IS NULL THEN NULL ELSE clock_timestamp() END; END IF;
 IF NEW.finished AND NOT OLD.finished THEN
  SELECT state INTO terminal_state FROM submissions WHERE id=NEW.submission_id;
  UPDATE guest_execution_usage SET charged_seconds=CASE WHEN terminal_state='completed' THEN COALESCE(elapsed,0) ELSE 0 END,settled_at=clock_timestamp() WHERE submission_id=NEW.submission_id AND settled_at IS NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION normalize_problem_children() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 INSERT INTO problem_languages VALUES(NEW.id,'python',NEW.public->>'starterSource',NEW.public->>'runtimeRevision',CASE WHEN NEW.fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE NEW.fixture->>'harnessRevision' END,NEW.fixture->>'referenceSource');
 INSERT INTO problem_examples SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->>'explanation','') FROM jsonb_array_elements(NEW.public->'examples') WITH ORDINALITY;
 INSERT INTO problem_test_cases SELECT NEW.id, ordinality-1, value->'args',value->'expected' FROM jsonb_array_elements(NEW.fixture->'hiddenCases') WITH ORDINALITY;
 INSERT INTO problem_tags SELECT NEW.id,value,ordinality-1 FROM jsonb_array_elements_text(NEW.public->'tags') WITH ORDINALITY;
 UPDATE problems SET current_version_id=NEW.id WHERE id=NEW.problem_id AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<NEW.version);
 RETURN NEW;
END $$;

CREATE FUNCTION normalize_problem_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE identity_id uuid;
BEGIN
 INSERT INTO problems(slug) VALUES(NEW.slug) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id INTO identity_id;
 NEW.problem_id := identity_id;
 NEW.title := NEW.public->>'title'; NEW.difficulty := NEW.public->>'difficulty';
 NEW.statement_markdown := NEW.public->>'statementMarkdown'; NEW.signature := NEW.public->'signature';
 NEW.constraints := COALESCE(NEW.public->'constraints','[]'); NEW.limits := NEW.public->'limits';
 NEW.comparator := NEW.fixture->>'comparator'; NEW.attribution := NEW.fixture->>'attribution';
 RETURN NEW;
END $$;

CREATE TABLE access_audit (
    operation_id text NOT NULL,
    actor text NOT NULL,
    user_id text NOT NULL,
    action text NOT NULL,
    scope text NOT NULL,
    reason text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT access_audit_pkey PRIMARY KEY (operation_id)
);

CREATE TABLE cancellation_idempotency (
    owner_id text NOT NULL,
    key text NOT NULL,
    submission_id uuid NOT NULL,
    response jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT cancellation_idempotency_pkey PRIMARY KEY (owner_id, key)
);

CREATE TABLE entitlement_grants (
    id uuid NOT NULL,
    user_id text NOT NULL,
    feature text NOT NULL,
    source text NOT NULL,
    source_ref text NOT NULL,
    valid_from timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    actor text NOT NULL,
    reason text NOT NULL,
    CONSTRAINT entitlement_grants_feature_check CHECK ((feature = ANY (ARRAY['internal'::text, 'matches.host_guests'::text, 'intelligence.hosted'::text, 'experimental'::text, 'interviews.host'::text, 'questions.custom'::text]))),
    CONSTRAINT entitlement_grants_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'internal'::text, 'subscription'::text]))),
    CONSTRAINT entitlement_grants_pkey PRIMARY KEY (id),
    CONSTRAINT entitlement_grants_user_id_feature_source_source_ref_key UNIQUE (user_id, feature, source, source_ref)
);

CREATE TABLE execution_attempt_usage (
    attempt_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    seconds integer NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT execution_attempt_usage_seconds_check CHECK (((seconds >= 0) AND (seconds <= 60))),
    CONSTRAINT execution_attempt_usage_pkey PRIMARY KEY (attempt_id)
);

CREATE TABLE execution_idempotency (
    owner_id text NOT NULL,
    key text NOT NULL,
    body_hash text NOT NULL,
    submission_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT execution_idempotency_pkey PRIMARY KEY (owner_id, key)
);

CREATE TABLE execution_jobs (
    id uuid NOT NULL,
    submission_id uuid NOT NULL,
    attempt_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    lease_until timestamp with time zone,
    finished boolean DEFAULT false NOT NULL,
    language text DEFAULT 'python'::text NOT NULL,
    runtime_revision text DEFAULT 'python-3.12-v1'::text NOT NULL,
    harness_revision text DEFAULT 'quorem-harness-v2'::text NOT NULL,
    attempt_started_at timestamp with time zone,
    CONSTRAINT execution_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT execution_jobs_submission_id_key UNIQUE (submission_id)
);

CREATE TABLE guest_execution_usage (
    submission_id uuid NOT NULL,
    match_id uuid NOT NULL,
    sponsor_id text NOT NULL,
    reserved_seconds integer DEFAULT 60 NOT NULL,
    charged_seconds integer,
    settled_at timestamp with time zone,
    admitted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT guest_execution_usage_charged_seconds_check CHECK (((charged_seconds >= 0) AND (charged_seconds <= 60))),
    CONSTRAINT guest_execution_usage_reserved_seconds_check CHECK ((reserved_seconds = 60)),
    CONSTRAINT guest_execution_usage_pkey PRIMARY KEY (submission_id)
);

CREATE TABLE guest_request_buckets (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    used integer NOT NULL,
    CONSTRAINT guest_request_buckets_pkey PRIMARY KEY (key, window_start)
);

CREATE TABLE guest_sessions (
    token_hash text NOT NULL,
    owner_id text NOT NULL,
    match_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT guest_sessions_owner_id_key UNIQUE (owner_id),
    CONSTRAINT guest_sessions_pkey PRIMARY KEY (token_hash)
);

CREATE TABLE guest_sponsor_locks (
    user_id text NOT NULL,
    CONSTRAINT guest_sponsor_locks_pkey PRIMARY KEY (user_id)
);

CREATE TABLE identity_bindings (
    issuer text NOT NULL,
    subject text NOT NULL,
    user_id text NOT NULL,
    CONSTRAINT identity_bindings_pkey PRIMARY KEY (issuer, subject)
);

CREATE TABLE interview_case_visibility (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    case_id text NOT NULL,
    CONSTRAINT interview_case_visibility_pkey PRIMARY KEY (session_id, question_epoch, case_id)
);

CREATE TABLE interview_execution (
    submission_id uuid NOT NULL,
    session_id uuid NOT NULL,
    document_version bigint NOT NULL,
    document_epoch uuid NOT NULL,
    fixture jsonb NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    progress_scope uuid,
    question_epoch uuid NOT NULL,
    private_results jsonb,
    CONSTRAINT interview_execution_pkey PRIMARY KEY (submission_id)
);

CREATE TABLE interview_guest_sessions (
    token_hash text NOT NULL,
    owner_id text NOT NULL,
    session_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '24:00:00'::interval) NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT interview_guest_sessions_owner_id_key UNIQUE (owner_id),
    CONSTRAINT interview_guest_sessions_pkey PRIMARY KEY (token_hash)
);

CREATE TABLE interview_language_drafts (
    session_id uuid NOT NULL,
    question_epoch uuid NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    CONSTRAINT interview_language_drafts_pkey PRIMARY KEY (session_id, question_epoch, language)
);

CREATE TABLE interview_members (
    session_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT interview_members_role_check CHECK ((role = ANY (ARRAY['interviewer'::text, 'interviewee'::text]))),
    CONSTRAINT interview_members_pkey PRIMARY KEY (session_id, user_id)
);

CREATE TABLE interview_operations (
    owner_id text NOT NULL,
    key text NOT NULL,
    fingerprint text NOT NULL,
    session_id uuid NOT NULL,
    response jsonb,
    CONSTRAINT interview_operations_pkey PRIMARY KEY (owner_id, key)
);

CREATE TABLE interview_outbox (
    sequence bigint NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT interview_outbox_id_key UNIQUE (id),
    CONSTRAINT interview_outbox_pkey PRIMARY KEY (sequence)
);

CREATE SEQUENCE interview_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE interview_outbox_sequence_seq OWNED BY interview_outbox.sequence;

CREATE TABLE interview_presence (
    session_id uuid NOT NULL,
    user_id text NOT NULL,
    client_id text NOT NULL,
    epoch uuid NOT NULL,
    version bigint NOT NULL,
    anchor integer NOT NULL,
    head integer NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT interview_presence_pkey PRIMARY KEY (session_id, user_id, client_id)
);

CREATE TABLE interview_rule_events (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT interview_rule_events_kind_check CHECK ((kind = ANY (ARRAY['paste'::text, 'focus'::text]))),
    CONSTRAINT interview_rule_events_pkey PRIMARY KEY (id)
);

CREATE TABLE interview_updates (
    session_id uuid NOT NULL,
    epoch uuid NOT NULL,
    version bigint NOT NULL,
    client_id text NOT NULL,
    changes jsonb NOT NULL,
    CONSTRAINT interview_updates_pkey PRIMARY KEY (session_id, epoch, version)
);

CREATE TABLE interviews (
    id uuid NOT NULL,
    host_id text NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    question jsonb NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    document_version bigint DEFAULT 0 NOT NULL,
    document_epoch uuid NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    invite_hash text NOT NULL,
    invite_token text NOT NULL,
    guest_joins integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    question_epoch uuid NOT NULL,
    interviewer_invite_token text NOT NULL,
    interviewer_invite_hash text NOT NULL,
    deleted_at timestamp with time zone,
    monitoring jsonb DEFAULT '{}'::jsonb NOT NULL,
    admission_locked boolean DEFAULT false NOT NULL,
    CONSTRAINT interviews_deleted_closed CHECK (((deleted_at IS NULL) OR (state = 'closed'::text))),
    CONSTRAINT interviews_monitoring_check CHECK ((jsonb_typeof(monitoring) = 'object'::text)),
    CONSTRAINT interviews_state_check CHECK ((state = ANY (ARRAY['active'::text, 'closed'::text]))),
    CONSTRAINT interviews_invite_hash_key UNIQUE (invite_hash),
    CONSTRAINT interviews_pkey PRIMARY KEY (id)
);

CREATE TABLE match_idempotency (
    owner_id text NOT NULL,
    route text NOT NULL,
    key text NOT NULL,
    body_hash text NOT NULL,
    response jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT match_idempotency_pkey PRIMARY KEY (owner_id, route, key)
);

CREATE TABLE match_outbox (
    sequence bigint NOT NULL,
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    version bigint NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT match_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['match.updated'::text, 'match.completed'::text]))),
    CONSTRAINT match_outbox_id_key UNIQUE (id),
    CONSTRAINT match_outbox_match_id_version_key UNIQUE (match_id, version),
    CONSTRAINT match_outbox_pkey PRIMARY KEY (sequence)
);

ALTER TABLE match_outbox ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME match_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE match_participants (
    match_id uuid NOT NULL,
    owner_id text NOT NULL,
    seat integer NOT NULL,
    ready boolean DEFAULT false NOT NULL,
    presence text DEFAULT 'offline'::text NOT NULL,
    workspace_id uuid,
    best_passed integer DEFAULT 0 NOT NULL,
    submission_state text,
    forfeited boolean DEFAULT false NOT NULL,
    last_rule_event_at timestamp with time zone,
    CONSTRAINT match_participants_presence_check CHECK ((presence = ANY (ARRAY['online'::text, 'offline'::text]))),
    CONSTRAINT match_participants_seat_check CHECK (((seat >= 1) AND (seat <= 8))),
    CONSTRAINT match_participants_match_id_seat_key UNIQUE (match_id, seat),
    CONSTRAINT match_participants_pkey PRIMARY KEY (match_id, owner_id)
);

CREATE TABLE match_reservations (
    owner_id text NOT NULL,
    match_id uuid NOT NULL,
    CONSTRAINT match_reservations_pkey PRIMARY KEY (owner_id)
);

CREATE TABLE match_rule_events (
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT match_rule_events_kind_check CHECK ((kind = ANY (ARRAY['clipboard'::text, 'focus'::text]))),
    CONSTRAINT match_rule_events_pkey PRIMARY KEY (id)
);

CREATE TABLE matches (
    id uuid NOT NULL,
    host_owner_id text NOT NULL,
    invite_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    difficulty text NOT NULL,
    duration_minutes integer NOT NULL,
    state text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    admission_sequence bigint DEFAULT 0 NOT NULL,
    problem_version_id uuid,
    started_at timestamp with time zone,
    deadline timestamp with time zone,
    finalizing_at timestamp with time zone,
    outcome jsonb,
    reconciled_at timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    mode text DEFAULT 'showdown'::text NOT NULL,
    difficulties text[] NOT NULL,
    selected_problem_version_id uuid,
    rules jsonb DEFAULT '{"focus": "off", "clipboard": "off"}'::jsonb NOT NULL,
    access_mode text DEFAULT 'accounts_only'::text NOT NULL,
    guest_joins integer DEFAULT 0 NOT NULL,
    guest_job_limit integer DEFAULT 120 NOT NULL,
    guest_seconds_limit integer DEFAULT 7200 NOT NULL,
    admission_locked boolean DEFAULT false NOT NULL,
    CONSTRAINT matches_access_mode_check CHECK ((access_mode = ANY (ARRAY['accounts_only'::text, 'guests_allowed'::text]))),
    CONSTRAINT matches_check CHECK (((started_at IS NULL) = (problem_version_id IS NULL))),
    CONSTRAINT matches_check1 CHECK (((state = ANY (ARRAY['completed'::text, 'cancelled'::text])) = (outcome IS NOT NULL))),
    CONSTRAINT matches_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT matches_duration_minutes_check CHECK ((duration_minutes = ANY (ARRAY[15, 30, 45, 60]))),
    CONSTRAINT matches_mode_check CHECK ((mode = ANY (ARRAY['showdown'::text, 'free-for-all'::text]))),
    CONSTRAINT matches_state_check CHECK ((state = ANY (ARRAY['waiting'::text, 'ready'::text, 'active'::text, 'finalizing'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT matches_invite_hash_key UNIQUE (invite_hash),
    CONSTRAINT matches_pkey PRIMARY KEY (id)
);

CREATE TABLE odyssey_progress (
    scope_id uuid NOT NULL,
    problem_version_id uuid NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    reset_at timestamptz NOT NULL DEFAULT '-infinity',
    CONSTRAINT odyssey_progress_level_check CHECK (((level >= 1) AND (level <= 8))),
    CONSTRAINT odyssey_progress_pkey PRIMARY KEY (scope_id, problem_version_id)
);

CREATE TABLE outbox_events (
    id uuid NOT NULL,
    aggregate_id uuid NOT NULL,
    type text NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT outbox_events_pkey PRIMARY KEY (id)
);

CREATE TABLE problem_examples (
    version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    args jsonb NOT NULL,
    expected jsonb NOT NULL,
    explanation text DEFAULT ''::text NOT NULL,
    CONSTRAINT problem_examples_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT problem_examples_pkey PRIMARY KEY (version_id, ordinal)
);

CREATE TABLE problem_languages (
    version_id uuid NOT NULL,
    language text NOT NULL,
    starter_source text NOT NULL,
    runtime_revision text NOT NULL,
    harness_revision text NOT NULL,
    reference_source text NOT NULL,
    CONSTRAINT problem_languages_language_check CHECK ((language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text]))),
    CONSTRAINT problem_languages_pkey PRIMARY KEY (version_id, language)
);

CREATE TABLE problem_solutions (
    version_id uuid NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    explanation_markdown text NOT NULL,
    time_complexity text NOT NULL,
    space_complexity text NOT NULL,
    complexity_notes text NOT NULL,
    CONSTRAINT problem_solutions_pkey PRIMARY KEY (version_id, language)
);

CREATE TABLE problem_tags (
    version_id uuid NOT NULL,
    tag text NOT NULL,
    ordinal integer NOT NULL,
    CONSTRAINT problem_tags_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT problem_tags_tag_check CHECK ((length(tag) > 0)),
    CONSTRAINT problem_tags_pkey PRIMARY KEY (version_id, tag),
    CONSTRAINT problem_tags_version_id_ordinal_key UNIQUE (version_id, ordinal)
);

CREATE TABLE problem_test_cases (
    version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    args jsonb NOT NULL,
    expected jsonb NOT NULL,
    CONSTRAINT problem_test_cases_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT problem_test_cases_pkey PRIMARY KEY (version_id, ordinal)
);

CREATE TABLE problem_versions (
    id uuid NOT NULL,
    slug text NOT NULL,
    version integer NOT NULL,
    public jsonb NOT NULL,
    fixture jsonb NOT NULL,
    problem_id uuid NOT NULL,
    title text NOT NULL,
    difficulty text NOT NULL,
    statement_markdown text NOT NULL,
    signature jsonb NOT NULL,
    constraints jsonb NOT NULL,
    limits jsonb NOT NULL,
    comparator text NOT NULL,
    attribution text NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    CONSTRAINT problem_versions_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT problem_version_identity UNIQUE (problem_id, id),
    CONSTRAINT problem_versions_pkey PRIMARY KEY (id),
    CONSTRAINT problem_versions_slug_version_key UNIQUE (slug, version)
);

CREATE TABLE problems (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    current_version_id uuid,
    owner_id text,
    CONSTRAINT problems_pkey PRIMARY KEY (id),
    CONSTRAINT problems_slug_key UNIQUE (slug)
);

CREATE TABLE question_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    content jsonb NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_version_id uuid,
    owner_id text,
    CONSTRAINT question_drafts_content_check CHECK (((jsonb_typeof(content) = 'object'::text) AND (octet_length((content)::text) <= 4194304))),
    CONSTRAINT question_drafts_revision_check CHECK ((revision > 0)),
    CONSTRAINT question_drafts_pkey PRIMARY KEY (id)
);

CREATE TABLE quota_overrides (
    user_id text NOT NULL,
    resource text NOT NULL,
    value integer NOT NULL,
    expires_at timestamp with time zone,
    actor text NOT NULL,
    reason text NOT NULL,
    CONSTRAINT quota_overrides_resource_check CHECK ((resource = ANY (ARRAY['guest_jobs'::text, 'guest_seconds'::text, 'guest_concurrency'::text, 'interview_concurrency'::text]))),
    CONSTRAINT quota_overrides_value_check CHECK (((value > 0) AND (value <= 600000))),
    CONSTRAINT quota_overrides_pkey PRIMARY KEY (user_id, resource)
);

CREATE TABLE submissions (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    source text NOT NULL,
    source_hash text NOT NULL,
    state text NOT NULL,
    cases jsonb NOT NULL,
    result jsonb,
    cancel_requested boolean DEFAULT false NOT NULL,
    admitted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    match_id uuid,
    match_sequence bigint,
    odyssey_level integer,
    CONSTRAINT submissions_kind_check CHECK ((kind = ANY (ARRAY['run'::text, 'submit'::text]))),
    CONSTRAINT submissions_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'cancelled'::text, 'failed'::text]))),
    CONSTRAINT submissions_pkey PRIMARY KEY (id)
);

CREATE TABLE users (
    id text NOT NULL,
    display_name text NOT NULL,
    admission_tokens double precision DEFAULT 2 NOT NULL,
    tokens_updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    participant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    kind text DEFAULT 'account'::text NOT NULL,
    profile_image text NOT NULL DEFAULT '',
    CONSTRAINT users_kind_check CHECK ((kind = ANY (ARRAY['account'::text, 'guest'::text]))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text]))),
    CONSTRAINT users_participant_id_key UNIQUE (participant_id),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE workspaces (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    problem_version_id uuid NOT NULL,
    language text NOT NULL,
    kind text DEFAULT 'solo'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    match_id uuid,
    odyssey_scope uuid,
    CONSTRAINT workspace_match_kind CHECK (((kind = 'match'::text) = (match_id IS NOT NULL))),
    CONSTRAINT workspaces_kind_check CHECK ((kind = ANY (ARRAY['solo'::text, 'match'::text]))),
    CONSTRAINT workspaces_language_check CHECK ((language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text]))),
    CONSTRAINT workspaces_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY interview_outbox ALTER COLUMN sequence SET DEFAULT nextval('interview_outbox_sequence_seq'::regclass);

CREATE INDEX guest_sessions_expiry ON guest_sessions USING btree (expires_at);

CREATE INDEX guest_usage_room ON guest_execution_usage USING btree (match_id);

CREATE INDEX guest_usage_sponsor ON guest_execution_usage USING btree (sponsor_id, admitted_at);

CREATE INDEX interview_execution_session ON interview_execution USING btree (session_id, submission_id);

CREATE UNIQUE INDEX interview_interviewer_invite ON interviews USING btree (interviewer_invite_hash);

CREATE INDEX interview_members_user ON interview_members USING btree (user_id) WHERE (removed_at IS NULL);

CREATE INDEX interview_outbox_pending ON interview_outbox USING btree (sequence) WHERE (published_at IS NULL);

CREATE INDEX interview_rule_events_actor ON interview_rule_events USING btree (session_id, owner_id, kind, occurred_at DESC);

CREATE INDEX interview_rule_events_recent ON interview_rule_events USING btree (session_id, occurred_at DESC, id DESC);

CREATE INDEX interviews_host_active ON interviews USING btree (host_id) WHERE (state = 'active'::text);

CREATE INDEX jobs_claim ON execution_jobs USING btree (available_at) WHERE (NOT finished);

CREATE INDEX match_reconciliation_order ON matches USING btree (reconciled_at, id) WHERE (state <> ALL (ARRAY['completed'::text, 'cancelled'::text]));

CREATE INDEX match_rule_events_match ON match_rule_events USING btree (match_id, occurred_at);

CREATE UNIQUE INDEX match_submission_order ON submissions USING btree (match_id, match_sequence) WHERE (match_sequence IS NOT NULL);

CREATE UNIQUE INDEX match_workspace_owner_language ON workspaces USING btree (match_id, owner_id, language) WHERE (kind = 'match'::text);

CREATE INDEX matches_reconcile ON matches USING btree (state, deadline, expires_at) WHERE (state <> ALL (ARRAY['completed'::text, 'cancelled'::text]));

CREATE UNIQUE INDEX owner_busy ON submissions USING btree (owner_id) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX problem_versions_problem_id ON problem_versions USING btree (problem_id);

CREATE INDEX problems_private_owner ON problems USING btree (owner_id) WHERE (owner_id IS NOT NULL);

CREATE INDEX question_drafts_created_by ON question_drafts USING btree (created_by);

CREATE INDEX question_drafts_private_owner ON question_drafts USING btree (owner_id, updated_at DESC, id DESC);

CREATE INDEX question_drafts_published_version ON question_drafts USING btree (published_version_id);

CREATE INDEX question_drafts_updated_at ON question_drafts USING btree (updated_at DESC, id);

CREATE INDEX question_drafts_updated_by ON question_drafts USING btree (updated_by);

CREATE UNIQUE INDEX solo_workspace ON workspaces USING btree (owner_id, problem_version_id, language) WHERE (kind = 'solo'::text);

CREATE INDEX submission_quota ON submissions USING btree (owner_id, admitted_at DESC);

CREATE INDEX unpublished_match_events ON match_outbox USING btree (sequence) WHERE (published_at IS NULL);

CREATE TRIGGER immutable_access_audit BEFORE DELETE OR UPDATE ON access_audit FOR EACH ROW EXECUTE FUNCTION immutable_access_audit();

CREATE TRIGGER immutable_problem_case BEFORE UPDATE ON problem_test_cases FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER immutable_problem_example BEFORE UPDATE ON problem_examples FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER immutable_problem_language BEFORE UPDATE ON problem_languages FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER immutable_problem_solution BEFORE UPDATE ON problem_solutions FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER immutable_problem_tag BEFORE UPDATE ON problem_tags FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER immutable_problem_version BEFORE UPDATE ON problem_versions FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();

CREATE TRIGGER interview_case_realtime AFTER INSERT OR DELETE ON interview_case_visibility FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER interview_execution_realtime AFTER INSERT OR UPDATE ON interview_execution FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER interview_member_realtime AFTER INSERT OR UPDATE ON interview_members FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER interview_presence_realtime AFTER INSERT OR DELETE OR UPDATE ON interview_presence FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER interview_realtime AFTER UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER interview_result_realtime AFTER UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION interview_changed();

CREATE TRIGGER meter_guest_execution BEFORE UPDATE ON execution_jobs FOR EACH ROW EXECUTE FUNCTION meter_guest_execution();

CREATE TRIGGER normalize_problem_after AFTER INSERT ON problem_versions FOR EACH ROW EXECUTE FUNCTION normalize_problem_children();

CREATE TRIGGER normalize_problem_before BEFORE INSERT ON problem_versions FOR EACH ROW EXECUTE FUNCTION normalize_problem_insert();

CREATE TRIGGER sealed_problem_case BEFORE INSERT OR DELETE OR UPDATE ON problem_test_cases FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_delete BEFORE DELETE ON problem_versions FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_delete();

CREATE TRIGGER sealed_problem_example BEFORE INSERT OR DELETE OR UPDATE ON problem_examples FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_language BEFORE INSERT OR DELETE OR UPDATE ON problem_languages FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_solution BEFORE INSERT OR DELETE OR UPDATE ON problem_solutions FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE TRIGGER sealed_problem_tag BEFORE INSERT OR DELETE OR UPDATE ON problem_tags FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

ALTER TABLE ONLY access_audit
    ADD CONSTRAINT access_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY cancellation_idempotency
    ADD CONSTRAINT cancellation_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY cancellation_idempotency
    ADD CONSTRAINT cancellation_idempotency_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id);

ALTER TABLE ONLY problems
    ADD CONSTRAINT current_publication_identity FOREIGN KEY (id, current_version_id) REFERENCES problem_versions(problem_id, id) ON DELETE SET NULL (current_version_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY entitlement_grants
    ADD CONSTRAINT entitlement_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY execution_attempt_usage
    ADD CONSTRAINT execution_attempt_usage_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY execution_idempotency
    ADD CONSTRAINT execution_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY execution_idempotency
    ADD CONSTRAINT execution_idempotency_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id);

ALTER TABLE ONLY execution_jobs
    ADD CONSTRAINT execution_jobs_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id);

ALTER TABLE ONLY guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_sponsor_id_fkey FOREIGN KEY (sponsor_id) REFERENCES users(id);

ALTER TABLE ONLY guest_execution_usage
    ADD CONSTRAINT guest_execution_usage_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY guest_sessions
    ADD CONSTRAINT guest_sessions_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY guest_sessions
    ADD CONSTRAINT guest_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY guest_sponsor_locks
    ADD CONSTRAINT guest_sponsor_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY identity_bindings
    ADD CONSTRAINT identity_bindings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY interview_case_visibility
    ADD CONSTRAINT interview_case_visibility_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_execution
    ADD CONSTRAINT interview_execution_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_execution
    ADD CONSTRAINT interview_execution_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY interview_guest_sessions
    ADD CONSTRAINT interview_guest_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_language_drafts
    ADD CONSTRAINT interview_language_drafts_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_members
    ADD CONSTRAINT interview_members_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_members
    ADD CONSTRAINT interview_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY interview_operations
    ADD CONSTRAINT interview_operations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY interview_operations
    ADD CONSTRAINT interview_operations_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_outbox
    ADD CONSTRAINT interview_outbox_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_presence
    ADD CONSTRAINT interview_presence_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_presence
    ADD CONSTRAINT interview_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY interview_rule_events
    ADD CONSTRAINT interview_rule_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_rule_events
    ADD CONSTRAINT interview_rule_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interview_updates
    ADD CONSTRAINT interview_updates_session_id_fkey FOREIGN KEY (session_id) REFERENCES interviews(id) ON DELETE CASCADE;

ALTER TABLE ONLY interviews
    ADD CONSTRAINT interviews_host_id_fkey FOREIGN KEY (host_id) REFERENCES users(id);

ALTER TABLE ONLY match_idempotency
    ADD CONSTRAINT match_idempotency_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY match_outbox
    ADD CONSTRAINT match_outbox_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY match_participants
    ADD CONSTRAINT match_participants_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY match_participants
    ADD CONSTRAINT match_participants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY match_participants
    ADD CONSTRAINT match_participants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY match_reservations
    ADD CONSTRAINT match_reservations_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY match_reservations
    ADD CONSTRAINT match_reservations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY match_rule_events
    ADD CONSTRAINT match_rule_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY match_rule_events
    ADD CONSTRAINT match_rule_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY matches
    ADD CONSTRAINT matches_host_owner_id_fkey FOREIGN KEY (host_owner_id) REFERENCES users(id);

ALTER TABLE ONLY matches
    ADD CONSTRAINT matches_problem_version_id_fkey FOREIGN KEY (problem_version_id) REFERENCES problem_versions(id);

ALTER TABLE ONLY matches
    ADD CONSTRAINT matches_selected_problem_version_id_fkey FOREIGN KEY (selected_problem_version_id) REFERENCES problem_versions(id);

ALTER TABLE ONLY problem_examples
    ADD CONSTRAINT problem_examples_version_id_fkey FOREIGN KEY (version_id) REFERENCES problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY problem_languages
    ADD CONSTRAINT problem_languages_version_id_fkey FOREIGN KEY (version_id) REFERENCES problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY problem_solutions
    ADD CONSTRAINT problem_solutions_version_id_language_fkey FOREIGN KEY (version_id, language) REFERENCES problem_languages(version_id, language) ON DELETE CASCADE;

ALTER TABLE ONLY problem_tags
    ADD CONSTRAINT problem_tags_version_id_fkey FOREIGN KEY (version_id) REFERENCES problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY problem_test_cases
    ADD CONSTRAINT problem_test_cases_version_id_fkey FOREIGN KEY (version_id) REFERENCES problem_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY problem_versions
    ADD CONSTRAINT problem_versions_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES problems(id);

ALTER TABLE ONLY problems
    ADD CONSTRAINT problems_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY question_drafts
    ADD CONSTRAINT question_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE ONLY question_drafts
    ADD CONSTRAINT question_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY question_drafts
    ADD CONSTRAINT question_drafts_published_version_id_fkey FOREIGN KEY (published_version_id) REFERENCES problem_versions(id);

ALTER TABLE ONLY question_drafts
    ADD CONSTRAINT question_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);

ALTER TABLE ONLY quota_overrides
    ADD CONSTRAINT quota_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY submissions
    ADD CONSTRAINT submissions_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY submissions
    ADD CONSTRAINT submissions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY submissions
    ADD CONSTRAINT submissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id);

ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);

ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_problem_version_id_fkey FOREIGN KEY (problem_version_id) REFERENCES problem_versions(id);

-- Exclude revoked grant history from per-command feature authorization.
CREATE INDEX entitlement_grants_unrevoked ON entitlement_grants (user_id, feature) WHERE revoked_at IS NULL;

-- Current-question results must not scan every previous question's executions.
CREATE INDEX interview_execution_question ON interview_execution (session_id, question_epoch, submission_id);

-- Notifications are transactional wakeups; execution_jobs and leases remain authoritative.
CREATE FUNCTION notify_execution_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_execution_jobs', '');
  RETURN NULL;
END;
$$;
CREATE TRIGGER execution_jobs_wakeup AFTER INSERT OR UPDATE OF available_at ON execution_jobs
FOR EACH STATEMENT EXECUTE FUNCTION notify_execution_jobs();

CREATE TABLE IF NOT EXISTS realtime_presence_leases (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (length(topic) <= 128 AND length(subject) <= 128)
);
CREATE INDEX IF NOT EXISTS realtime_presence_subject ON realtime_presence_leases(topic,subject,expires_at);
CREATE INDEX IF NOT EXISTS realtime_presence_expiry ON realtime_presence_leases(expires_at);

CREATE OR REPLACE FUNCTION notify_match_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_match_outbox','');
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_outbox_notification AFTER INSERT ON match_outbox
FOR EACH STATEMENT EXECUTE FUNCTION notify_match_outbox();

CREATE TABLE IF NOT EXISTS maintenance_schedule (
  task text PRIMARY KEY,
  next_run_at timestamptz NOT NULL
);
