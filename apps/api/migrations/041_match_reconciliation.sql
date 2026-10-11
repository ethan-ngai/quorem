ALTER TABLE matches ADD COLUMN reconciled_at timestamptz NOT NULL DEFAULT '-infinity';
CREATE INDEX match_reconciliation_order ON matches(reconciled_at,id) WHERE state NOT IN ('completed','cancelled');
