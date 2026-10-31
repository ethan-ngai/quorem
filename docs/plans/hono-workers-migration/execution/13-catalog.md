# 13 Catalog queries (issue #360)

Added an unmounted Hono catalog router, domain query ports and PostgreSQL read adapter. Routes require an injected identity resolver and resolve identity before invoking a query; request headers never select an owner. The adapter opens a bounded read-only repeatable-read transaction per operation. Current catalog uses four queries regardless of result count: page, count and unfiltered topic/company options. Detail uses one; editorial reads use one authorization/gate query and at most one content query. No cache or search service is involved.

The explicit public SQL projection selects published metadata, public examples, first Odyssey stage, language starter artifacts and `lossless_public`. It never selects `lossless_fixture`, hidden cases, staged-private rows or `reference_source`. Raw public numeric values are decoded and encoded with the canonical lossless question codec. Stored starter artifacts are the existing publication-generated immutable values; reads do not regenerate historical starters. Editorial complexity fetches only complexity columns, and active-match spoiler checks execute inside the same snapshot. Private version access requires the owner or a non-forfeited participant in an active/finalizing match. Slug and catalog reads expose only current global or owner versions; version reads preserve immutable historical access.

The existing page/limit API remains supported with bounded offset; cursor requests use stable keyset ordering over title/slug or difficulty/title/slug. `nextCursor` and its `cursor` request parameter are in the OpenAPI source and generated client. The existing UI still uses numbered pages. Existing numbered pages are not keyset-backed. The candidate port retains the Go selected-version and filtered SQL behavior; callers own selection and transaction orchestration.

Validation used an independently created disposable UTF-8 database `127.0.0.1:55441/quorem_hono_catalog_test`, migrated with `DATABASE_URL=... go run ./apps/api/cmd/provision`. Its restricted read role was denied `problem_versions.lossless_fixture` and `problem_languages.reference_source`; the same role exercised queries. Tests cover public/private, owner, anonymous, participant, forfeit, changed ownership, closed match, unpublished current pointer, historical version, first-stage and NUL-bearing public sidecar, filters, cursor, candidates and editorial gate. Scope acquisition is injected after identification. No development database was used or truncated.

```sh
QUOREM_CATALOG_TEST_DATABASE_URL=postgres://engai@127.0.0.1:55441/quorem_hono_catalog_test?sslmode=disable vp -C apps/api exec vitest run --config src/adapters/postgres/problems/queries/vitest.config.ts
QUOREM_CATALOG_TEST_DATABASE_URL=postgres://engai@127.0.0.1:55441/quorem_hono_catalog_test?sslmode=disable vp -C apps/api exec vitest run --config src/adapters/postgres/problems/queries/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp -C packages/contracts run check
vp check --no-fmt apps/api/src/modules/problems apps/api/src/adapters/postgres/problems/queries
```

The workerd fixture uses the actual `developmentIdentity` PostgreSQL lookup before opening a separate restricted catalog connection. With the pinned upstream socket lifecycle patch from [#365](https://github.com/ethan-ngai/quorem/pull/365), root reran native Vitest against the disposable database: all three assertions passed with no unhandled errors. Coverage includes projection, four-query count, released backend PID, denied private columns and disabled-user rejection. Standalone Wrangler returned 200 with `no-store`, request ID, four catalog queries and a backend PID absent after completion. Hosted behavior remains unverified.

A PostgreSQL repeatable-read race test pauses an in-flight authorized query, commits participant forfeiture, then resumes: the already-started snapshot may complete, and the following request denies access. A 50 ms connection lifetime test rejects a stalled scope, and a real denied column grant maps to a sanitized 503. Instrumentation counted exactly four SQL statements for catalog. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on this small disposable dataset produced root nodes Aggregate, Limit and two Sort/Unique facets; a sample run measured 0.034–0.180 ms execution per statement. These are diagnostic evidence, not production-scale performance claims.

Cursor migration: keep numbered page links until the UI stores a cursor per filter/sort and navigation history; then consume `nextCursor` for forward navigation and preserve page links or explicitly migrate deep links. Measure deep-page behavior and update the client contract tests before retiring offset. Do not silently change current numbered-page results.

Live identity composition and mounting remain integration-owned; no production route or fake auth was installed. Production-scale query plans, other concurrent revocations and hosted behavior remain unverified. The `@quorem/questions` API dependency and root lockfile are synchronized.
