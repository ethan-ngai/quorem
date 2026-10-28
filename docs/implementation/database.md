# Database schema

Product and auth each start at one baseline: `apps/api/migrations/007_schema.sql` and `apps/auth/migrations/001_schema.sql`. These declare tables, constraints, indexes and triggers directly. Fixture identities are created by explicit local product seeding, not schema creation.

Startup applies unapplied SQL files in filename order, inside a transaction and service-specific advisory lock. Each service records filenames in its own `schema_migrations` table. Product databases with a contiguous prefix of the archived history execute remaining steps and replace the ledger with the current baseline in the same transaction. The archive manifest records and verifies the historical files and baseline identity. This includes removal of the retired Odyssey entitlement. Unknown or incomplete histories fail without changes. Add future changes as new numbered migrations; do not change an applied baseline.

Published problem fields, languages, examples, hidden cases and Odyssey cases are read from versioned relational records. SQL and Odyssey definitions remain structured JSON. Public projections omit hidden cases and restrict Odyssey to its first level; trusted execution and interview paths assemble full fixtures. The original JSON snapshots remain during rollout because older app instances still read and write them. Migration 024 rejects conflicting snapshots or projections instead of silently choosing one. Its backfill and indexes run under the migration transaction; assess lock time on hosted data before rollout.

## Existing local databases

Recognized product migration histories upgrade automatically. For older local databases whose schema already matches the baseline but whose history is unavailable, adopt the baseline ledger explicitly:

```sh
DATABASE_URL='postgres://quorem:quorem@127.0.0.1:54329/quorem?sslmode=disable' \
  python3 scripts/adopt-schema.py --service product
AUTH_DATABASE_URL='postgres://quorem:quorem@127.0.0.1:54329/quorem_auth?sslmode=disable' \
  python3 scripts/adopt-schema.py --service auth
```

Use the actual URLs from your local environment. The tool requires PostgreSQL client tools and loopback databases. It builds a temporary reference database, compares `pg_dump --schema-only` output with the existing service schema, and updates only the ledger when they match exactly. A mismatch leaves the database untouched and reports the difference. The temporary database is removed afterward. Application rows, auth identities and browser drafts are preserved.

Older or drifted schemas require a separate fresh database or an explicitly reviewed data migration. `make reset` remains the deliberate destructive local reset; adoption never calls it. There is no production upgrade path for the retired preproduction chain.

## Integration tests

`QUOREM_TEST_DATABASE_URL` and `AUTH_TEST_DATABASE_URL` must name separate disposable databases, never running development databases. Product tests truncate fixture state; HTTP suites isolate their own schemas. Auth suites run serially against a disposable auth schema. Test a fresh baseline and repeated startup before adding schema changes.
