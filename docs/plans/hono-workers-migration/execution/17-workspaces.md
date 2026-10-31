# 17: Workspace and Odyssey

Issue #371. Unmounted workspace routes require an injected identity resolver and the shared identity error mapper. The repository creates or reads immutable owner/version/language workspaces; it checks current question visibility, user state and, for match workspaces, active participation, host state and live scoped guest credentials. Browser drafts remain browser-owned. Guest callers cannot create solo workspaces.

Odyssey reads select only the unlocked stage prefix and public case statuses, then restore exact example values through the shared catalog projection. No private fixture or reference-source column is read. Reset locks the owner in the same order as submission admission, rejects queued/running jobs, and writes a fresh reset timestamp on both insertion and update. This also excludes older feedback when resetting a workspace whose progress row did not yet exist. Reset has no idempotency key in the existing HTTP contract: a later repeated reset after new work is a new reset, not a replay-safe operation.

The catalog-owned `public-projection.ts` now owns transactional visibility SQL and public example restoration for catalog and workspace consumers. Catalog's four-query list and restricted-role tests still pass. `identity/routes.ts` extends the shared mapper from f96bfcf to map guest Origin denial to 403 while retaining 401 credential failures and 503 outages; integration must preserve that addition.

## Local validation

Only a disposable database may be used: the Node integration test drops `public`, reapplies product migrations, and creates fixtures.

```sh
export WORKSPACE_FIXTURE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-workspace-17 -e POSTGRES_PASSWORD="$WORKSPACE_FIXTURE_PASSWORD" -e POSTGRES_DB=quorem_hono_workspace_test -p 127.0.0.1:55451:5432 postgres:17
export QUOREM_WORKSPACE_TEST_DATABASE_URL="postgresql://postgres:$WORKSPACE_FIXTURE_PASSWORD@127.0.0.1:55451/quorem_hono_workspace_test"
vp -C apps/api exec node --test src/adapters/postgres/workspace/integration.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/workspace/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp check --no-fmt
docker rm -f quorem-hono-workspace-17
```

Passed five PostgreSQL/Node integration tests and two native workerd PostgreSQL tests, covering concurrent creation, owner/language/privacy, exact large-number and NUL examples, locked-stage/private redaction, guest membership/host disablement/revocation, reset/admission locking, reset epoch and public feedback, and HTTP identity/errors. The catalog Node suite (two tests) and workerd suite (three tests, restricted role and four-query assertion) passed on a second disposable database in the same container; their port guards were temporarily pointed at 55451 for the run and restored afterward. Typecheck, import boundaries and root lint passed.

No runtime mount or hosted test is included. Interview execution has its own question snapshot and epoch, not a `workspaces` row; its membership and stage controls remain with the interview owner. Match/interview transition and admission implementations remain with their packets. The local tests do not establish hosted capacity or full old/new rollout parity.
