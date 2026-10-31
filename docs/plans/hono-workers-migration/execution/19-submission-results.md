# 19 Submission results and cancellation

Issue #377. `submissionSnapshots(run)` supplies `read`, `interview`, and `cancel`; each returns a lossless JSON snapshot. `submissionRoutes` exposes the corresponding owner and interview routes with mandatory injected identity. The snapshot port can be reused by the realtime and aggregate owners. Routes are not mounted here.

Reads project only the Go submission fields, public case fields and hidden-case index/status. The result and interview result/fixture bytea sidecars are decoded with the canonical question JSON codec; NUL and large numeric lexemes survive. Interview submission details require current membership and enabled host. Interviewers see admitted-level private details; interviewees see only explicitly revealed cases from the current question epoch. Generic interview-submit reads omit hidden cases and diagnostics. Guest identities are revalidated in the transaction and must match the submission's match/interview scope.

Cancellation uses PostgreSQL advisory lock 740020 and a submission row lock, preserving the existing judge completion lock order. Queued work finishes its job and becomes cancelled; running work sets the cancellation request and waits for the judge to settle. Match submits and already completed/failed work reject cancellation. A 24-hour owner/key record returns the committed response on retry and rejects key reuse for another submission. PostgreSQL triggers remain responsible for notices; no job or attempt identifier is returned.

Disposable PostgreSQL 17 on 127.0.0.1:55459, database `quorem_hono_results_test`:

```sh
QUOREM_RESULTS_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec node --test src/adapters/postgres/judging/results/integration.ts
QUOREM_RESULTS_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/judging/results/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp check --no-fmt
```

Node: 11 passed, including HTTP, concurrent retries, both cancellation/completion lock orderings, stale attempt predicate, guest scopes/revocation, outage, interviewer/reveal/epoch, and NUL/large-number sidecars. Workerd: 3 PostgreSQL-backed tests passed for HTTP read/cancel/retry, lossless public result privacy, and live guest revocation. Race tests exercise the existing judge's PostgreSQL lock and attempt predicate; they do not execute a TypeScript judge completion command. Admission packet 18 was not ready in this checkout: fixtures insert schema-valid submissions/jobs directly, and an admission-to-read/cancel test is still required after integration. Hosted behavior was not tested.
