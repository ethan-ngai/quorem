ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
CREATE TABLE identity_bindings (
 issuer text NOT NULL, subject text NOT NULL,
 user_id text NOT NULL REFERENCES users(id),
 PRIMARY KEY (issuer,subject)
);
