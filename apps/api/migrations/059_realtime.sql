ALTER TABLE match_outbox ADD COLUMN IF NOT EXISTS published_at timestamptz;
CREATE INDEX IF NOT EXISTS unpublished_match_events ON match_outbox(sequence) WHERE published_at IS NULL;
