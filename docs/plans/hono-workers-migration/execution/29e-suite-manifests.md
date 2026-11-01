# 29e Suite manifests

Issue #409. Admission counts sealed fixture references in PostgreSQL and binds the ordered primary and sample sets with `INSERT ... SELECT`; only counts and existing request-bounded custom cases cross into the Worker. Migration 058 replaces the 320-row manifest and result ordinal checks with PostgreSQL integer bounds. Source, metadata and suite binding remain transactional and sealed.

`quorem_suite_digest(job_id)` starts with SHA-256 of UTF-8 `quorem-suite-v1`, then for each ordinal in order replaces its 32-byte state with SHA-256 of `state || int4send(ordinal) || UTF8(channel) || 00 || blob_hash`. The database function uses an ordered cursor and constant digest state; the fenced reader returns the hex digest and supports ordinals through 2147483646. The judge's checkpoint, staging, verification, and result consumers require the coordinated 27 changes; 29e alone does not activate suites over 320.

The requested >320 fresh authored Odyssey is impossible under current Go policy: `internal/problems/odyssey.go` permits at most 20 hidden cases and 20 examples per stage, with eight stages, hence at most 320 total. The actual authoring→admission test exercises that 320-case limit. A separate explicitly synthetic indexed legacy fixture exercises 400 hidden cases and eight examples; it is not claimed to be valid fresh authoring. This migration adds no new aggregate quota.

Disposable PostgreSQL 17 at `127.0.0.1:55574`, databases `quorem_hono_suite_manifest_test`, `quorem_hono_engine_test`, `quorem_hono_admission_test`, `quorem_hono_schema_test`:

```sh
QUOREM_SUITE_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec node --test src/adapters/postgres/judging/admission/suite-manifests.integration.ts
QUOREM_SUITE_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/judging/admission/vitest.suite-workers.config.ts
QUOREM_ENGINE_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/judging/admission/vitest.runner.config.ts
QUOREM_ADMISSION_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/judging/admission/vitest.config.ts
QUOREM_SCHEMA_TEST_DATABASE_URL=<disposable-url> vp -C packages/database exec node --test src/migrations.test.ts
vp -C apps/api run typecheck
```

Node: 2 suite tests pass; 320 authored and 408 synthetic refs preserve ordering, independent digest agrees, and fenced reader fetches ordinal 407. Instrumented selection returned at most one database row per query. Native workerd: synthetic 408-reference admission passes. Runner input suite: 9 passed, 2 skipped; admission suite: 20 passed, 4 skipped. Fresh migration/catalog parity and API typecheck pass. These establish bounded reference transfer, not an end-to-end Worker heap benchmark or hosted validation.

Interview admission integration awaits 29c's active-question producer: tests reach the existing `Execution fixture unavailable` gate on this base. Packet 27 must finish widening checkpoint, provenance, completion, and result consumers before larger jobs can execute. No verified-outcome acceptance is claimed.
