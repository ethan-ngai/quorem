# 29d Match manifest reconciliation

Issue #408. **Incomplete; activation blocked.** Reconciliation currently treats every submission as unresolved. It never trusts legacy `submissions.cases`, result scores, or checkpoint counters. This prevents an unverified result from deciding a match, but verified scores, first-correct wins, and Odyssey progress are unavailable. Existing finalization timeout can still produce no contest.

Packet 27 must provide transaction-bound `verifiedMatchProgress(tx, jobId)`: sealed manifest count, independently verified checkpoint failures, and terminal verdict/pass count only after exact ordinal coverage and matching completed-attempt receipt. This is a proposed contract, not an implemented verifier. Integrate it and test actual verified completion before enabling this path. A manifest hash, frame status, legacy `definite_failures`, or completion receipt alone is not proof.

Disposable PostgreSQL 17 at 127.0.0.1:55572, database `quorem_hono_manifest_reconcile_test`:

```sh
QUOREM_MATCH_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec node --test src/adapters/postgres/matches/reconcile/integration.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/matches/reconcile/vitest.config.ts
QUOREM_MATCH_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/matches/reconcile/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
```

Node PostgreSQL: 8 passed, including actual 29b admission and rejection of forged accepted results and legacy checkpoint certainty. Pure policy: 7 passed. Native workerd: 9 passed, including PostgreSQL rejection of unverified completion. No verified-success integration, hosted validation, or activation claim.

`vp check --no-fmt` fails on existing 054 `inputProtocol` errors in admission, interview and runner test fixtures, plus an unrelated interview sort warning.
