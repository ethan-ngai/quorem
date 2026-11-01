-- Coverage is established separately; this record preserves the verified initial authority.
CREATE TABLE stage_genesis (
 singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT stage_genesis_singleton_check CHECK (singleton),
 database_identity text NOT NULL CONSTRAINT stage_genesis_database_identity_check CHECK (octet_length(database_identity) BETWEEN 1 AND 512),
 namespace text NOT NULL CONSTRAINT stage_genesis_namespace_check CHECK (namespace ~ '^[a-f0-9]{64}$'),
 scope text NOT NULL CONSTRAINT stage_genesis_scope_check CHECK (scope ~ '^remote:[a-f0-9]{64}$'),
 initial_operation uuid NOT NULL CONSTRAINT stage_genesis_operation_check CHECK (initial_operation::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
 initial_release text NOT NULL CONSTRAINT stage_genesis_release_check CHECK (initial_release ~ '^[a-f0-9]{40}$'),
 initial_bindings text NOT NULL CONSTRAINT stage_genesis_bindings_check CHECK (initial_bindings ~ '^[a-f0-9]{64}$'),
 owner_key_sha256 text NOT NULL CONSTRAINT stage_genesis_owner_key_check CHECK (owner_key_sha256 ~ '^[a-f0-9]{64}$'),
 genesis_envelope jsonb NOT NULL,
 migration_062_sha256 text NOT NULL CONSTRAINT stage_genesis_migration_check CHECK (migration_062_sha256 ~ '^[a-f0-9]{64}$')
);
REVOKE ALL ON stage_genesis FROM PUBLIC;
CREATE FUNCTION guard_stage_genesis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'stage genesis is immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER stage_genesis_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON stage_genesis
 FOR EACH STATEMENT EXECUTE FUNCTION guard_stage_genesis();
