# Database schema

Product and auth schemas are owned by `apps/api/migrations` and `apps/auth/migrations`. Startup applies migrations in filename order under a transaction and a service-specific advisory lock. Each service records applied filenames in its own `schema_migrations` table; unknown or noncontiguous histories fail without changes. Add new numbered migrations instead of changing applied files.

Published problem fields, languages, examples, hidden cases and Odyssey cases live in versioned relational records. SQL and Odyssey definitions remain structured JSON. Public projections omit hidden cases and restrict Odyssey to its first level; trusted execution and interview paths assemble full fixtures. Migration 024 rejects conflicting snapshots or projections instead of silently choosing one, and migration 025 removes the retired snapshots and unused outbox. Migrations execute transactionally and may lock populated tables.

Submissions belong to exactly one workspace or interview. Interview execution records retain the admitted question snapshot so later edits cannot change an in-flight or historical execution; their session identity is constrained to match the submission. Submission cases and results are snapshots of the admitted and completed job. Match and interview membership, guest usage, idempotency and realtime outboxes remain separate records with their own lifecycles. Better Auth owns its separate schema and provider-defined account, session and passkey fields.

## Integration tests

`QUOREM_TEST_DATABASE_URL` and `AUTH_TEST_DATABASE_URL` must name separate disposable databases, never running development databases. Product tests truncate fixture state; HTTP suites isolate their own schemas. Auth suites run serially against a disposable auth schema. Test a fresh baseline and repeated startup before adding schema changes.
