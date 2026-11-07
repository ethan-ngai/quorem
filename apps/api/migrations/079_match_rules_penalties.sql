-- Existing rooms retain their assistance access; new rooms use Balanced defaults.
CREATE FUNCTION pg_temp.upgrade_match_rules(old jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"victory":"race","settingsEditors":"host","clipboard":"off","copy":"off","focus":"off","behavioralSeconds":15,"behavioralPoints":2,"focusGraceSeconds":3,"focusFreeWarnings":1,"assistance":{"topics":{"access":"free","seconds":30,"points":3},"complexity":{"access":"free","seconds":60,"points":5},"hiddenCase":{"access":"free","seconds":120,"points":10}},"feedback":"verdicts","submissions":{"cooldownSeconds":0,"freeSubmissions":3,"seconds":0,"points":0}}'::jsonb || jsonb_build_object(
 'clipboard',COALESCE(old->>'clipboard','off'),'copy',COALESCE(old->>'clipboard','off'),'focus',COALESCE(old->>'focus','off'),
 'assistance',jsonb_build_object(
 'topics',jsonb_build_object('access',CASE WHEN old->'hints'->>'topics'='false' THEN 'blocked' ELSE 'free' END,'seconds',30,'points',3),
 'complexity',jsonb_build_object('access',CASE WHEN old->'hints'->>'complexity'='true' THEN 'free' ELSE 'blocked' END,'seconds',60,'points',5),
 'hiddenCase',jsonb_build_object('access','blocked','seconds',120,'points',10)))
$$;
UPDATE matches SET rules=pg_temp.upgrade_match_rules(rules);
UPDATE parties SET settings=jsonb_set(settings,'{rules}',pg_temp.upgrade_match_rules(settings->'rules'));
ALTER TABLE match_participants ADD COLUMN competitor_id text;
UPDATE match_participants SET competitor_id=owner_id;
-- Null uses owner_id for individual matches; teams assign their stable team ID.
ALTER TABLE match_rule_events DROP CONSTRAINT match_rule_events_kind_check;
ALTER TABLE match_rule_events ADD COLUMN competitor_id text;
UPDATE match_rule_events SET competitor_id=owner_id;
ALTER TABLE match_rule_events ALTER COLUMN competitor_id SET NOT NULL;
ALTER TABLE match_rule_events ADD COLUMN action text NOT NULL DEFAULT 'announce';
ALTER TABLE match_rule_events ADD COLUMN seconds integer NOT NULL DEFAULT 0 CHECK(seconds>=0);
ALTER TABLE match_rule_events ADD COLUMN points integer NOT NULL DEFAULT 0 CHECK(points>=0);
ALTER TABLE match_rule_events ADD COLUMN resource_key text;
ALTER TABLE match_rule_events ADD COLUMN submission_id uuid;
ALTER TABLE match_rule_events ADD CONSTRAINT match_rule_events_kind_check CHECK(kind IN ('clipboard','copy','focus','topics','complexity','hiddenCase','submission'));
CREATE UNIQUE INDEX match_rule_reveal_once ON match_rule_events(match_id,competitor_id,kind,resource_key) WHERE resource_key IS NOT NULL;
CREATE INDEX match_rule_competitor ON match_rule_events(match_id,competitor_id,occurred_at);
CREATE TABLE match_private_result_cases (
 submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 result_data bytea NOT NULL,
 PRIMARY KEY(submission_id,ordinal)
);
ALTER TABLE match_participants ADD COLUMN eligible_finish_at timestamptz;
ALTER TABLE match_participants ADD COLUMN best_percentage double precision NOT NULL DEFAULT 0;
ALTER TABLE matches ALTER COLUMN rules SET DEFAULT '{"victory":"race","settingsEditors":"host","clipboard":"announce","copy":"off","focus":"announce","behavioralSeconds":15,"behavioralPoints":2,"focusGraceSeconds":3,"focusFreeWarnings":1,"assistance":{"topics":{"access":"penalty","seconds":30,"points":3},"complexity":{"access":"penalty","seconds":60,"points":5},"hiddenCase":{"access":"penalty","seconds":120,"points":10}},"feedback":"verdicts","submissions":{"cooldownSeconds":10,"freeSubmissions":3,"seconds":0,"points":0}}'::jsonb;
ALTER TABLE matches ADD COLUMN rule_deadline timestamptz;
