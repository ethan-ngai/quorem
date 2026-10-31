# 13 Catalog queries (issue #360)

Added an unmounted Hono catalog router, domain query ports and PostgreSQL read adapter. Routes require an injected identity resolver and resolve identity before invoking a query; request headers never select an owner. The adapter opens a bounded read-only repeatable-read transaction per operation. Current catalog uses four queries regardless of result count: page, count and unfiltered topic/company options. Detail uses one; editorial reads use one authorization/gate query and at most one content query. No cache or search service is involved.

The explicit public SQL projection selects published metadata, public examples, first Odyssey stage, language starter artifacts and `lossless_public`. It never selects `lossless_fixture`, hidden cases, staged-private rows or `reference_source`. Raw public numeric values are decoded and encoded with the canonical lossless question codec. Stored starter artifacts are the existing publication-generated immutable values; reads do not regenerate historical starters. Editorial complexity fetches only complexity columns, and active-match spoiler checks execute inside the same snapshot. Private version access requires the owner or a non-forfeited participant in an active/finalizing match. Slug and catalog reads expose only current global or owner versions; version reads preserve immutable historical access.

The existing page/limit API remains supported with bounded offset; cursor requests use stable keyset ordering over title/slug or difficulty/title/slug. `nextCursor` is an additive response field and is not yet reflected in the generated public contract or UI. Existing numbered pages are not keyset-backed. The candidate port retains the Go selected-version and filtered SQL behavior; callers own selection and transaction orchestration.

Validation used an independently created disposable UTF-8 database `127.0.0.1:55441/quorem_hono_catalog_test`, migrated with `DATABASE_URL=... go run ./apps/api/cmd/provision`. Its restricted read role was denied `problem_versions.lossless_fixture` and `problem_languages.reference_source`; the same role exercised queries. Tests cover public/private, owner, anonymous, participant, forfeit, changed ownership, closed match, unpublished current pointer, historical version, first-stage and NUL-bearing public sidecar, filters, cursor, candidates and editorial gate. Scope acquisition is injected after identification. No development database was used or truncated.

```sh
QUOREM_CATALOG_TEST_DATABASE_URL=postgres://engai@127.0.0.1:55441/quorem_hono_catalog_test?sslmode=disable vp -C apps/api exec vitest run --config src/adapters/postgres/problems/queries/vitest.config.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/problems/queries/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp check --no-fmt apps/api/src/modules/problems apps/api/src/adapters/postgres/problems/queries
```

The workerd test exercises HTTP with injected query ports, not a workerd PostgreSQL connection. Live identity composition and mounting are owned by integration; no endpoint is activated here. The query tests use the dedicated database and synthetic data; broader concurrent revocation, production-scale query plans and hosted behavior remain unverified. The new `@quorem/questions` API dependency requires the integration owner to update the root lockfile.
