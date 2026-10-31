# 26: Interview execution admission

`postgresInterviewAdmission(run, {losslessCases, guestExecution})` composes the shared prearm receipt, owner quotas, execution-intent writer, source hash, case selector, and interview authority. It locks the owner and interview, verifies the current question/document epochs, source hash and stage, then atomically stores the submission, job, immutable fixture, public example sidecars and operation response. A prior operation resolves its original submission before checking changed epochs or source, after current membership and active-host authority. The unmounted `interviewExecutionRoutes` calls the shared required-prewake flow before any admission transaction. Existing `submissionSnapshots.interview` owns role-scoped streaming reads.

Fixture IDs use the Go PostgreSQL `jsonb::text` SHA-256 identity and collision equality check; NUL and lossless-number source bytes remain in the canonical sidecar. Custom case operation fingerprints retain validated Go RawMessage spelling. Interview Odyssey advancement remains host-controlled: the canonical completion owner now auto-advances workspace submissions only.

Validation on disposable `127.0.0.1:55470/quorem_hono_interview_execution_test`:

- `QUOREM_INTERVIEW_EXECUTION_TEST_URL=... vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/execution/vitest.config.ts`: 3 passed. Covers Go fingerprint vector, immutable lossless fixture identity, real admission/replay after edit, removed membership, source and stage fences, streamed interviewer/candidate/reveal projections, real accepted completion, and completion/manual-pass race.
- Same URL, `vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/execution/vitest.workers.config.ts`: 1 passed against PostgreSQL in workerd; a failed required prewake admitted no job, and a successful request/retry returned one submission.
- Existing question and document PostgreSQL suites: 3 passed each; presence suite: 1 passed. Shared prewake unit tests: 4 passed. `vp -C apps/api run typecheck`, `vp -C apps/api run check:boundaries`, and targeted `vp check --no-fmt`: passed.

Production mounting and scheduler/provider integration remain external. The shared prewake wrapper maps immediate provider errors to 503; retrying an already committed operation still invokes prewake first and can fail while the provider is unavailable. 051/052 sidecar backfills and old-writer drain remain cutover gates. No hosted sandbox execution was performed.
