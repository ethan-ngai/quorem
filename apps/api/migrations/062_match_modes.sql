ALTER TABLE matches DROP CONSTRAINT matches_mode_check;
ALTER TABLE matches ADD CONSTRAINT matches_mode_check CHECK(mode IN ('showdown','free-for-all'));
ALTER TABLE matches ADD COLUMN difficulties text[];
UPDATE matches SET difficulties=ARRAY[difficulty];
ALTER TABLE matches ALTER COLUMN difficulties SET NOT NULL;
ALTER TABLE matches ADD COLUMN selected_problem_version_id uuid REFERENCES problem_versions(id);
ALTER TABLE matches ADD COLUMN rules jsonb NOT NULL DEFAULT '{"clipboard":"off","focus":"off"}';
ALTER TABLE match_participants DROP CONSTRAINT match_participants_seat_check;
ALTER TABLE match_participants ADD CONSTRAINT match_participants_seat_check CHECK(seat BETWEEN 1 AND 8);
ALTER TABLE match_participants ADD COLUMN forfeited boolean NOT NULL DEFAULT false;
ALTER TABLE match_participants ADD COLUMN cooldown_until timestamptz;
ALTER TABLE match_participants ADD COLUMN last_rule_event_at timestamptz;
CREATE TABLE match_rule_events(id uuid PRIMARY KEY,match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,owner_id text NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('clipboard','focus')),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX match_rule_events_match ON match_rule_events(match_id,occurred_at);
UPDATE match_idempotency SET response=response || jsonb_build_object('difficulties',jsonb_build_array(response->>'difficulty'),'rules','{"clipboard":"off","focus":"off"}'::jsonb,'ruleEvents','[]'::jsonb) WHERE response ? 'participants';

INSERT INTO users(id,display_name,participant_id) VALUES ('charlie','Charlie','00000000-0000-4000-8000-000000000003'),('dana','Dana','00000000-0000-4000-8000-000000000004') ON CONFLICT(id) DO UPDATE SET participant_id=EXCLUDED.participant_id;
