ALTER TABLE execution_checkpoints ADD COLUMN definite_failures integer NOT NULL DEFAULT 0 CHECK (definite_failures BETWEEN 0 AND 320);
