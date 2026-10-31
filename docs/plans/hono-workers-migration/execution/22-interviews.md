# Interview lifecycle and private projections

Packet 22 supplies injectable lifecycle routes and PostgreSQL operations for create, list, invite preview, join, role changes, removal, admission lock, close and deletion. Membership and capability checks occur in the transaction. Question preparation uses canonical publication, validation and storage owners. Routes remain unmounted pending application composition.

Migration 051 adds public example and private case/result sidecars plus security-barrier views with explicit public metadata. Reads require complete generation markers and select only the permitted stage or revealed cases. Missing or partial rows fail closed. Privileged `backfillInterviewBatch` handles bounded batches; `backfillInterviewPublicExamples`, `backfillSnapshotPublicExamples` and `backfillPrivateResultCases` are transaction-bound single-item operations. Result backfill locks both submission and execution and accepts terminal submissions only. The completion owner must call `savePrivateResultCases` and write the index/status-only execution summary atomically. Snapshot writers must persist the matching examples and case rows in their transaction. Old Go writers and judges must be drained before activation; operator CLI wiring and production migration/validation remain outstanding.

The product schema includes the explicit 049 dispatch-intent foreign key correction already integrated upstream as 7ba69eb. No hosted behavior is claimed.

Validation on disposable PostgreSQL 55462 (`quorem_hono_interview_test` and `quorem_hono_schema_test`):

- `node --experimental-strip-types --test src/adapters/postgres/interviews/lifecycle/integration.ts`: 15 passed, including concurrent lifecycle, epoch/backfill, restricted-role private result, guest and lossless cases.
- `vp exec vitest run --config src/adapters/postgres/interviews/lifecycle/vitest.workers.config.ts`: 2 passed against real PostgreSQL.
- `node --test src/migrations.test.ts`: schema and view parity passed.
- API and database `vp run typecheck`, API `vp run check:boundaries`: passed. Guest identity suite: 6 passed.

Admission, question mutation/advance, completion and application mounting remain owned by their respective packets; their composition must use these transaction-bound primitives and run the combined suites before activation.
