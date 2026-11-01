# Staging cutover and rollback

[Plan index](README.md)

### Local coexistence

Keep Go and TS entrypoints explicitly selectable during development. Use separate fixture databases for differential replay and write tests; never shadow production mutations. Compare nondeterministic IDs/times only through reviewed normalization. Contract/hash bytes, safe payloads and authorization decisions remain exact where meaningful.

Prefer no public route splitting during initial implementation. Product authorization, transaction behavior and socket snapshots must be validated as an integrated application. Temporary selection belongs in runtime ingress, with an owner and deletion gate; no per-domain compatibility flags embedded in services.

### Staging

1. Apply only additive migrations with existing readers/writers still compatible. Validate restored production-shaped data in an isolated database, including active matches/interviews, old sessions, private versions, lossless payloads and checkpoints.
2. Exercise mixed Go API/TS judge and TS API/Go judge where supported, then all-TS. Existing runtime/harness revisions and claim capabilities govern admission. Unsupported mixed pairs block rollout explicitly.
3. Deploy native API/auth beside current app containers; keep Pages/static routing and case sandbox service distinct. New browser DO classes/namespaces need explicit Terraform migration handling. Do not rename/delete live classes casually.
4. Validate controlled end-to-end workload: existing baseline 20 matches/40 coding sessions, 2 execution requests/sec burst; then higher workloads only with a declared test profile. Include prolonged typing, reconnect storms, cold starts, queue outage and maximum suite/replay sizes.
5. Record p50/p95 HTTP and command latency, disconnects, queue/outbox age, deadline lateness, lease failures, DB connections/lock waits, Worker CPU/memory, judge memory and spend. Compare to measured baseline and existing operating defaults; no unmeasured performance promises.

### Production cutover

Provision with Terraform; deploy through GitHub Actions. Production/main promotion requires explicit authorization. Keep all local and CI release gates active, including hosted sandbox validation.

- Retain same origin, cookie names, auth issuer/audience and key material; do not silently invalidate accounts/sessions or change provider callback URLs.
- Scope canary ownership coherently: entire match/interview and its sockets, not random individual requests. If stable aggregate routing cannot be proven, use a controlled whole-backend cutover after draining active sessions. Never let old/new authorities run different transition semantics for one aggregate.
- Pause new admission where required, drain old judges and active sessions/connections, verify capable readers/writers and byte/checkpoint flags, then route new traffic. Keep PostgreSQL attempt fencing; a routing switch alone does not prove old processes stopped.
- Activate TS background processors with idempotent claims. Account for old outbox/deadline processors during overlap; either prove safe concurrent ownership or quiesce them before enabling replacements.
- Preserve per-role runtime configuration revisions and old-instance fencing. Replace app-container pool capacity controls with explicit Worker/DO/database quotas; remove old controls only when their resource no longer serves traffic.
- Verify API/auth role versions, WS protocol, actual run/submit/result flow, outbox recovery, deadline recovery, credentials and DLQ monitoring. Frontend deployment or green unit tests do not establish backend promotion.

### Rollback constraints

Maintain a known compatible previous deployment and an exercised ingress rollback until cutover observation passes. Rollback is a runtime switch, not a destructive schema downgrade. Stop new admissions, fence/drain new writers and judges as needed, restore routing/background ownership, reconnect sockets and repair from PostgreSQL.

Before reverting readers, apply `docs/implementation/database.md` capability/drain rules. Byte-sidecar writes and resumable jobs can make old readers/judges unsafe; disabling flags does not erase retained payloads. Verify actual queued/running jobs, checkpoints, sidecar records and reader capabilities. Keep capable services available until the rollback target can safely read every retained record. Never discard checkpoints or convert NUL-bearing bytes to JSONB to make rollback pass.

Preserve existing password hashes and session keys throughout rollback. New outbox/schema fields remain additive until rollback closes. Temporary Go/TS coexistence ends after an agreed observation period backed by workload evidence; no permanent translation proxy.
