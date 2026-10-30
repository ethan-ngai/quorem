# Database schema

Product and auth schemas are owned by `apps/api/migrations` and `apps/auth/migrations`. Startup applies migrations in filename order under a transaction and a service-specific advisory lock. Each service records applied filenames in its own `schema_migrations` table; unknown or noncontiguous histories fail without changes. Add new numbered migrations instead of changing applied files.

Published problem fields, languages, examples, hidden cases and Odyssey cases live in versioned relational records. SQL and Odyssey definitions remain structured JSON. Public projections omit hidden cases and restrict Odyssey to its first level; trusted execution and interview paths assemble full fixtures. Migration 024 rejects conflicting snapshots or projections instead of silently choosing one, and migration 025 removes the retired snapshots and unused outbox. Migrations execute transactionally and may lock populated tables.

Submissions belong to exactly one workspace or interview. Each interview submission and its execution reference one another through deferred and immediate foreign keys. Executions reference immutable, content-addressed question snapshots, so later edits cannot change a historical execution. Identical snapshots are shared within a session and follow its lifetime. Submission cases and results capture the admitted and completed job. Match and interview membership, guest usage, idempotency and realtime outboxes have separate lifecycles. Better Auth owns its separate schema and provider-defined account, session and passkey fields.

Workspace identity is immutable. Its language must be available for its problem version; submission and participant references must match its owner and match context.

The current interview document lives on the session. Language drafts store inactive documents; switching consumes the selected draft and saves the outgoing document atomically.

## Integration tests

`QUOREM_TEST_DATABASE_URL` and `AUTH_TEST_DATABASE_URL` must name separate disposable databases, never running development databases. Product tests truncate fixture state; HTTP suites isolate their own schemas. Auth suites run serially against a disposable auth schema. Test a fresh baseline and repeated startup before adding schema changes.

Execution result payloads support arbitrary JSON strings, including NUL. Queryable verdicts, scores and case statuses remain in JSONB; full public and interviewer-private output can be stored as opaque bytes. Existing JSONB results remain readable. `QUOREM_LOSSLESS_RESULT_WRITES` defaults off; enable it on judges only after every API reader supports byte payloads and all older readers have drained. An old reader cannot detect a summary-only row, so rollback to it is not fail-closed. Before rolling back readers: disable the flag on every judge, drain all previously enabled judges, retain byte-aware APIs while results expire, and verify `SELECT (SELECT count(*) FROM submissions WHERE result_payload IS NOT NULL), (SELECT count(*) FROM interview_execution WHERE private_results_payload IS NOT NULL)` returns two zeros. Do not convert NUL-bearing payloads to JSONB; PostgreSQL cannot represent them. Old writers clear any existing opaque payload when replacing its JSONB value. Terminal payloads follow the existing 7-day guest and 30-day account retention; cleanup triggers also protect payload deletion when an older API clears submission results.

Coding cases with NUL use byte payloads alongside JSONB query projections. `QUOREM_LOSSLESS_CASES` defaults off and also requires `QUOREM_LOSSLESS_RESULT_WRITES=true`; both must be enabled on API and judge processes. Roll out byte-aware readers everywhere first, drain older API readers, then enable lossless result writes on all judges and finally enable lossless cases on all APIs and judges. Old readers can return sanitized case projections, so do not activate while any old reader remains. Database guards reject old writers for sidecar-backed drafts and interviews and reject old judges claiming affected work; newer disabled judges skip affected jobs. Old binaries can still block the queue on an affected job.

Disabling the flags stops new NUL cases but does not make existing payloads safe for old readers. Before rolling back readers, drain enabled writers and judges and remove or replace every NUL-bearing draft, version, interview, and retained submission through byte-aware tooling; verify all `lossless_content`, `lossless_fixture`, `lossless_public`, `lossless_stages`, `lossless_question`, and `lossless_cases` columns are NULL. Never convert these bytes to JSONB. Public problem reads select public examples separately from private fixtures; Odyssey progress restores only unlocked stage examples. Interview fixtures and admitted submission cases retain private data and follow their existing ownership and cleanup boundaries.

The production Actions workflow passes these repository variables to Terraform; unset means `false`. Change them only as part of an authorized production rollout, then dispatch the production workflow on `main` and verify the target role rollout before the next step. Application and judge settings have separate runtime-revision hashes; the application router fences old revisions, but rollout status alone does not prove every old process has drained.

| Repository variable                | Role  | Purpose                                                         |
| ---------------------------------- | ----- | --------------------------------------------------------------- |
| `QUOREM_API_LOSSLESS_RESULTS`      | API   | Permit lossless case handling alongside result-capable readers. |
| `QUOREM_API_LOSSLESS_CASES`        | API   | Accept and persist NUL-bearing coding cases.                    |
| `QUOREM_JUDGE_LOSSLESS_RESULTS`    | Judge | Write lossless result payloads.                                 |
| `QUOREM_JUDGE_LOSSLESS_CASES`      | Judge | Claim and execute NUL-bearing cases.                            |
| `QUOREM_JUDGE_RESUMABLE_EXECUTION` | Judge | Opt in to checkpointed execution independently.                 |

For lossless cases: deploy the byte-aware code and migrations with every variable false; verify old API readers have drained before enabling API case settings. The deployment seed runs before the Terraform rollout and can write NUL-bearing data as soon as those settings are enabled. Enable judge lossless results and verify every old API reader is gone before any judge writes payloads. Enable judge lossless cases and verify capable judges are serving, then enable both API lossless settings. Do not combine these steps into one apply: Terraform validates configured dependencies but cannot prove deployment order or process drainage. For resumable execution, first deploy checkpoint-aware judges with its variable false, verify older judges have drained, then enable it in a separate rollout. Hosted isolation, capacity, and end-to-end rollout remain release checks.

To disable new lossless case writes, first set `QUOREM_API_LOSSLESS_CASES=false` and roll the API; leave both judge settings enabled while affected queued and running jobs finish. Disable judge cases only after that drain. Disable result writers only after no enabled API or judge requires them; leave byte-aware readers in place until all payloads and the earlier count checks are clear before reverting code. To disable resumable execution, stop admitting work and keep an enabled judge until all checkpointed jobs are terminal, then disable the judge variable. Do not delete checkpoints to clear a queue. Terraform dependency validation prevents API case enablement without both API result capability and judge case/result settings; it does not replace the drain checks.

Before downgrading case readers, run this read-only check after draining enabled processes; every count must be zero:

```sql
SELECT
  (SELECT count(*) FROM question_drafts WHERE lossless_content IS NOT NULL) AS drafts,
  (SELECT count(*) FROM problem_versions WHERE lossless_fixture IS NOT NULL OR lossless_public IS NOT NULL OR lossless_stages IS NOT NULL) AS versions,
  (SELECT count(*) FROM interviews WHERE lossless_question IS NOT NULL) AS interviews,
  (SELECT count(*) FROM interview_question_snapshots WHERE lossless_fixture IS NOT NULL) AS snapshots,
  (SELECT count(*) FROM submissions WHERE lossless_cases IS NOT NULL) AS submissions;
```

Published versions and interview snapshots can outlive submissions. There is no general safe deletion cascade or automated conversion for these records; retain byte-aware readers until those records are deliberately resolved. A zero result alone does not prove old processes have stopped writing.
