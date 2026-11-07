ALTER TABLE parties ADD COLUMN faction_names jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE matches ADD COLUMN faction_names jsonb NOT NULL DEFAULT '[]'::jsonb;
