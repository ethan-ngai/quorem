ALTER TABLE matches ADD COLUMN mode text NOT NULL DEFAULT 'showdown' CHECK (mode = 'showdown');

-- Preserve replay responses under the new required snapshot contract.
UPDATE match_idempotency
SET response = jsonb_set(response, '{mode}', '"showdown"'::jsonb)
WHERE response ? 'participants';
