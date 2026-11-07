ALTER TABLE users ADD COLUMN profile_color integer NOT NULL DEFAULT 0 CHECK (profile_color BETWEEN 0 AND 24);
ALTER TABLE users ADD COLUMN profile_color_revision bigint NOT NULL DEFAULT 0;
