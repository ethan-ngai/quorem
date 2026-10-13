ALTER TABLE quorem_auth."user" ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE quorem_auth."user" ADD COLUMN IF NOT EXISTS "displayUsername" text;
CREATE UNIQUE INDEX IF NOT EXISTS auth_username_unique ON quorem_auth."user"(username) WHERE username IS NOT NULL;
