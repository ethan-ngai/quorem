# 30b: Interview snapshot boundaries

Interview creation, join, lifecycle, question and monitoring mutations return `{id}` after their transaction; operation replay preserves the ID and callers obtain current authorized content separately. The interview list returns at most 50 bounded summaries with ID, title, state, host, role, problem title and member count. Browser creation and language switching fetch a current snapshot after acknowledgement; join uses the returned ID. OpenAPI and generated contracts reflect these shapes.

`interviewSnapshotStream(run)` prepares an authorized metadata plan, then streams public example arrays and role- or reveal-scoped private cases in at most 64 KiB chunks. Private cases use the shared allowlist projection. Each page rechecks identity, membership, role, question epoch, room version, sidecar row identity and reveal state; revoked or changed streams terminate. No connection remains open under network backpressure. Existing unbounded public-example and private-case snapshot readers were removed. Full result payloads remain with the existing 19b HTTP stream owner.

Validation:

- Disposable PostgreSQL `55489/quorem_hono_stream_lifecycle_test`: 15/15 lifecycle, restricted-role, guest, publication, numeric, stage and backfill tests passed; workerd lifecycle suite 2/2 passed.
- Disposable PostgreSQL `55466/quorem_hono_interview_questions_test`: native workerd HTTP stream test passed with 300 KB examples and 300 KB private case, <=64 KiB chunks, candidate/staff isolation, allowlist projection, and aborts on demotion, version change and removal.
- Existing question/document/execution/presence PostgreSQL suites: 3/3/3/1 passed; corresponding workerd suites: 1 each passed. API/web typechecks, API boundaries, generated contract check and targeted lint passed.

Production runtime composition and actual 21 socket conformance remain integration work. 051/052 sidecar backfill and old-writer drain remain cutover gates; streams fail closed on missing or changed sidecars. A disconnected client must retry the authorized GET.
