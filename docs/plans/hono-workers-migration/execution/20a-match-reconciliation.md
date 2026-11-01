# 20a Match reconciliation

Issue #379. `reconcile` is the provider-free owner of ordered score/progress, first-correct, uncertainty, checkpoint bounds and deadline/finalization decisions. It uses PostgreSQL epoch microseconds to preserve deadline boundaries. `reconcileMatch(tx, id)` is the transaction-bound persistence entry: callers own the transaction and lock any owner before entering; it locks the match, samples database time after the lock, persists progress and outcome, and emits one versioned match outbox notice when changed. Admission may call it after its own owner→match→sponsor→queue locking. `reconcileScheduledMatch(tx, id, generation)` additionally updates the reconciliation timestamp and deletes only the observed pending generation; deleted matches are harmless stale wakes.

Terminal outcomes translate the winner's private owner ID to its public participant ID, shorten guest-session expiry and delete match reservations atomically. Existing guest execution reservations remain unsettled until judge settlement, matching Go. Outbox notices contain aggregate IDs, version and event type only. Match create/join/transport and scheduler composition remain with their owners; no routes or timers are mounted here.

Disposable PostgreSQL 17 on 127.0.0.1:55461, database `quorem_hono_match_test`:

```sh
QUOREM_MATCH_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec node --test src/adapters/postgres/matches/reconcile/integration.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/matches/reconcile/vitest.config.ts
QUOREM_MATCH_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/matches/reconcile/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp check --no-fmt
```

Node PostgreSQL: 7 passed, including concurrent reconciliation, post-lock deadline expiry, admission-lock ordering, generation fencing, checkpoint certainty, no-contest timeout, guest reservation handling and safe notice contents. Node pure Go-derived vectors: 7 passed. Native workerd: 8 passed, including the same pure vectors and real PostgreSQL terminal/replay behavior. Admission packet 18 still needs end-to-end integration with this exported transaction function; tests here use a schema-valid transactional admission fixture. No hosted validation.
