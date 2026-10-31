# 23b: Interview questions

Question selection, hint visibility, language switching, manual host-only Odyssey advancement, and interviewer case visibility use the existing membership, operation, snapshot, and private sidecar owners. Selection atomically resets question/document state and stores public examples and private cases. Language changes fence the document epoch and preserve per-language drafts. Commands recheck current membership and hosting entitlement; retries retain Go-compatible operation fingerprints, including escaped raw case literals. HTTP routes require injected identity and are not mounted in production here.

The bounded `backfill-interview-cases.ts` operator command uses the bounded interview input backfill owner. It requires the verified bootstrap administrator, an operation ID and reason, and supports `--dry-run`; writes require `--legacy-drained` and recheck authority. Drain old writers and judges before activation and repeat bounded batches until complete. No production data was touched.

Validation on disposable PostgreSQL `127.0.0.1:55466/quorem_hono_interview_questions_test`:

- `QUOREM_INTERVIEW_QUESTIONS_TEST_URL=... vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/question/vitest.config.ts`: 3 passed. Covers private ownership, revocation, stale epochs, idempotent replay, Go fingerprint vectors and operator backfill.
- Same URL, `vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/question/vitest.workers.config.ts`: 1 passed in workerd against PostgreSQL; includes selection/advance race and revocation.
- `vp -C apps/api exec vitest run --config src/cli/vitest.config.ts`: 4 passed, 6 database-dependent tests skipped.
- `vp -C apps/api run typecheck`, `vp -C apps/api run check:boundaries`, and targeted `vp check --no-fmt`: passed.

Production composition remains with runtime integration. The canonical transaction-bound interview snapshot is reused; integration with the 19b/052 streaming result owner and its legacy result-status bounds remains a separate gate. Structural request checks precede replay; nested custom semantics remain with the canonical question validator on new operations.
