ALTER TABLE matches ADD COLUMN question_filters jsonb NOT NULL DEFAULT '{}'::jsonb;
