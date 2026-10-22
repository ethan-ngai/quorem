ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'account' CHECK(kind IN ('account','guest'));
ALTER TABLE matches ADD COLUMN access_mode text NOT NULL DEFAULT 'accounts_only' CHECK(access_mode IN ('accounts_only','guests_allowed'));
ALTER TABLE matches ADD COLUMN guest_joins integer NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN guest_job_limit integer NOT NULL DEFAULT 120;
ALTER TABLE matches ADD COLUMN guest_seconds_limit integer NOT NULL DEFAULT 7200;
ALTER TABLE matches ADD COLUMN admission_locked boolean NOT NULL DEFAULT false;
CREATE TABLE entitlement_grants (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), feature text NOT NULL CHECK(feature IN ('internal','matches.host_guests','intelligence.hosted','experimental')),
 source text NOT NULL CHECK(source IN ('manual','internal','subscription')), source_ref text NOT NULL,
 valid_from timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz, revoked_at timestamptz,
 actor text NOT NULL, reason text NOT NULL, UNIQUE(user_id,feature,source,source_ref)
);
CREATE TABLE quota_overrides (
 user_id text NOT NULL REFERENCES users(id), resource text NOT NULL CHECK(resource IN ('guest_jobs','guest_seconds','guest_concurrency')),
 value integer NOT NULL CHECK(value>0 AND value<=600000), expires_at timestamptz, actor text NOT NULL, reason text NOT NULL,
 PRIMARY KEY(user_id,resource)
);
CREATE TABLE access_audit (
 operation_id text PRIMARY KEY, actor text NOT NULL, user_id text NOT NULL REFERENCES users(id), action text NOT NULL,
 scope text NOT NULL, reason text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION immutable_access_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Access audit is append only'; END $$;
CREATE TRIGGER immutable_access_audit BEFORE UPDATE OR DELETE ON access_audit FOR EACH ROW EXECUTE FUNCTION immutable_access_audit();
CREATE TABLE guest_sessions (
 token_hash text PRIMARY KEY, owner_id text NOT NULL UNIQUE REFERENCES users(id), match_id uuid NOT NULL REFERENCES matches(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX guest_sessions_expiry ON guest_sessions(expires_at);
CREATE TABLE guest_sponsor_locks (user_id text PRIMARY KEY REFERENCES users(id));
CREATE TABLE guest_execution_usage (
 submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE, match_id uuid NOT NULL REFERENCES matches(id),
 sponsor_id text NOT NULL REFERENCES users(id), reserved_seconds integer NOT NULL DEFAULT 60 CHECK(reserved_seconds=60),
 charged_seconds integer CHECK(charged_seconds BETWEEN 0 AND 60), settled_at timestamptz,
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX guest_usage_sponsor ON guest_execution_usage(sponsor_id,admitted_at);
CREATE INDEX guest_usage_room ON guest_execution_usage(match_id);
ALTER TABLE execution_jobs ADD COLUMN attempt_started_at timestamptz;
CREATE TABLE execution_attempt_usage (
 attempt_id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 seconds integer NOT NULL CHECK(seconds BETWEEN 0 AND 60), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION meter_guest_execution() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER meter_guest_execution BEFORE UPDATE ON execution_jobs FOR EACH ROW EXECUTE FUNCTION meter_guest_execution();
CREATE TABLE guest_request_buckets (key text NOT NULL, window_start timestamptz NOT NULL, used integer NOT NULL, PRIMARY KEY(key,window_start));
