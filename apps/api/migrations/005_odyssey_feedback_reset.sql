ALTER TABLE odyssey_progress ADD COLUMN reset_at timestamptz NOT NULL DEFAULT '-infinity';
