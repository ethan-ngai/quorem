# 29f Manifest regression coverage

Issue #411. Match reconciliation now derives progress only from `verifiedMatchProgress`: independently compared signed evidence bound to the sealed manifest and current attempt. Missing, malformed, stale, or unverified scores and legacy counters remain unresolved. Terminal score and verdict require complete receipt-backed evidence; early verified failures provide a conservative upper bound. Odyssey stage metadata is checked before use. Aggregate locks, deadline sampling, settlement and safe notices remain in the existing owner.

Disposable PostgreSQL 17 at `127.0.0.1:55576`, separate `quorem_hono_match_manifest_test`, `quorem_hono_runner_test`, `quorem_hono_engine_test`, `quorem_hono_interview_questions_test`, and `quorem_hono_interview_execution_test`. `seed-interview-regression.ts` seeds only the two named interview databases after migration. The Docker socket and local verifier are fixture-only.

- Match Node: 14 passed. Actual admission, sealed manifests, Docker execution, loopback Node HTTP verifier and signed 057 evidence produce accepted, wrong-answer, syntax, runtime and time-limit results. A paused first job's early verified failure permits the guest's later win; guest usage settles and late completion cannot overturn the winner. Includes lock wait, deadline, no-contest, stale scheduling and unverified-score denial.
- Match native workerd: 9 passed, including pure Go-derived positive policy vectors and PostgreSQL denial of unverified results.
- Runner Node: 11 passed with no skips. Includes real Python and TypeScript Docker execution, checkpoint-v2 tamper/fence tests, resumed compiled artifact, signed verifier, cancellation, cleanup and guest accounting. A real legacy Go runner is rejected by the manifest protocol guard.
- Runner native workerd: 1 passed against PostgreSQL and the loopback HTTP verifier.
- Interview question 23: Node 3 passed, workerd 1 passed on seeded disposable DB.
- Interview execution 26: 1 passed, 2 failed at the pre-existing missing active-question mapping on this base. Integrate the actual 29c producer, then rerun 26 Node and workerd; do not seed a fake mapping. This packet is not complete until that integration passes.
- API typecheck and `vp check --no-fmt` pass; the latter reports one pre-existing interview document sort warning.

Use the named disposable URLs with `vp -C apps/api exec node --test src/adapters/postgres/matches/reconcile/integration.ts`, `vp -C apps/api exec vitest run --config src/adapters/postgres/matches/reconcile/vitest.workers.config.ts`, and the worker and interview `vitest.config.ts` / `vitest.workers.config.ts` beside their tests. Match and engine Docker tests also require `QUOREM_TEST_DOCKER_SOCKET`; runner workerd uses the local `verification-test-server.ts` origin and public key. No hosted validation.
