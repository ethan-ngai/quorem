# 24: Interview documents

`interviewDocumentCommands(run)` supplies read, pull and push; `interviewDocumentRoutes({documents, identify})` supplies unmounted HTTP routes. Commands reuse the interview lock, current membership and entitlement checks, idempotency records, document epochs and language drafts. Pull returns ordered batches of at most 256; push applies at most 32 atomic ChangeSets. The official `@codemirror/state` parser runs behind source, UTF-16, NUL and byte-limit checks. Failed batches roll back. The raw HTTP push body preserves Go `json.RawMessage` spelling for stored fingerprint replay; other transports must pass the original decoded UTF-8 push object text as `rawBody` when available. The passed raw body is bounded and must decode to the same command.

Validation on disposable `127.0.0.1:55468/quorem_hono_interview_documents_test`:

- `QUOREM_INTERVIEW_DOCUMENT_TEST_URL=... vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/document/vitest.config.ts`: 3 passed. Covers Go changes and fingerprint vectors, malformed Unicode, NUL and size limits, concurrent pushes, lost ACK, 256-update pagination, rollback, entitlement revocation, and language draft recovery.
- Same URL, `vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/document/vitest.workers.config.ts`: 1 passed against PostgreSQL in workerd, including concurrent writers and escaped-change replay.
- `vp -C apps/api exec vitest run src/test/boundaries.test.ts`: 4 passed. `vp -C apps/api run typecheck`, `vp -C apps/api run check:boundaries`, and targeted `vp check --no-fmt`: passed.
- Existing CLI scanner regression: 4 passed, 6 database-dependent tests skipped.

The API package declares `@codemirror/state` at the existing web range `^6.5.2`; root owns lock integration. Runtime mounting and realtime push-body extraction remain integration work. Read/pull currently use the shared transaction-bound interview lock, so they serialize with mutations; concurrency/load impact has not been benchmarked.
