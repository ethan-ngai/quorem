CREATE TABLE IF NOT EXISTS quorem_auth.passkey (
  id text PRIMARY KEY,
  name text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES quorem_auth."user"(id) ON DELETE CASCADE,
  "credentialID" text NOT NULL UNIQUE,
  counter bigint NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" boolean NOT NULL,
  transports text,
  "createdAt" timestamptz,
  aaguid text
);
CREATE INDEX IF NOT EXISTS auth_passkey_user ON quorem_auth.passkey("userId");
