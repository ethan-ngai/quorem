# 25: Interview presence and monitoring

`interviewPresence(run)` provides `peers`, `update`, `acquire`, `renew`, and `release`; `interviewMonitoring(run, snapshot)` provides `setPolicy` and `report`. Unmounted HTTP route factories use injected identity. Socket leases use database-clock expiry, four concurrent leases per room and subject, and fenced renewal; editor presence separately expires after 20 seconds with four windows per member. Advisory reads use the shared unlocked membership check; the presence upsert rechecks membership, host entitlement, document epoch and version in its write statement. Stale presence is excluded on read. Room mutations retain their existing lock. Runtime must schedule renewals and close sockets on renewal failure or authority loss; no process-local quota is authoritative.

Monitoring defaults to enabled, permits policy changes only by the host, accepts only paste/focus kinds from interviewees, deduplicates operation keys and events within two seconds, and bounds persisted history to 100 on insertion. Snapshot ownership continues to enforce interviewer-only event visibility. Clipboard contents are not accepted.

Validation on disposable PostgreSQL `127.0.0.1:55469/quorem_hono_interview_presence_test`:

- `QUOREM_INTERVIEW_PRESENCE_TEST_URL=... vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/presence/vitest.config.ts`: 1 passed. Covers concurrent replica quotas and renewals, expiration/reconnect, stale-lease fencing, role removal, policy and event privacy, bounded history, and presence plus heartbeat while a document room lock is held. Also checks the existing locked access path still waits.
- Same URL, `vp -C apps/api exec vitest run --config src/adapters/postgres/interviews/presence/vitest.workers.config.ts`: 1 passed against real PostgreSQL in workerd, including multi-instance quota, heartbeat and advisory updates under a held document lock, and paste/focus HTTP privacy.
- `vp -C apps/api run typecheck`, `vp -C apps/api run check:boundaries`, and targeted `vp check --no-fmt`: passed.

Runtime socket lanes, scheduling and production route mounting remain integration work; the tests exercise independent repository operations, not a deployed gateway or network fault recovery. Concurrent authorization changes are rechecked at statement boundaries; an already committed advisory lease expires or fails renewal after revocation.
