# Operating defaults

Engineering baseline chosen under delegated judgment. Values are initial enforceable limits/targets, not measured claims; benchmark and adjust through an ADR while preserving confirmed product behavior.

## Execution

| Limit | Initial value |
| --- | --- |
| Source | 64 KiB UTF-8 |
| Custom input | 64 KiB; up to 20 cases |
| Hidden suite | 20 equally weighted cases per seed problem/version |
| Per-case Python process | 2 seconds wall time, 256 MiB memory, 16 process/task limit |
| Case output capture | 64 KiB per stdout/stderr stream; exceeding limit fails that case |
| Test result value | 64 KiB encoded; bounded node traversal |
| Submission worker budget | 60 seconds including startup and all 20 cases |
| Queue lease | 90 seconds; heartbeat every 15 seconds; fenced attempt ID |
| Infrastructure retries | At most 2 retries; bounded by match finalization window |
| Per-owner active work | Exactly one queued/running job across Run and Submit |
| Admission quota | 10 new jobs/minute, burst 2; 100 jobs/day per owner initially |
| Global pressure | Bounded queue 200; reject when saturated with Retry-After |

Use fresh sandboxed Python execution state per case; trusted comparison runs outside it. A contestant timeout/memory/output/runtime failure gives zero for that case and remaining cases still run. Syntax/setup errors attributable to code produce zero across the suite. Infrastructure crash cannot become a zero score; replay/fencing or no contest handles uncertainty. If total budget exhaustion prevents complete comparable scoring, treat the result as infrastructure/scoring failure rather than inventing passed counts. Fixture validation must prove the complete suite fits the declared total budget, including worst-case per-case limits.

Worker concurrency starts at two local slots; public pool sized by benchmark/cost, bounded by configuration. Quotas protect cost but are not a billing cap. Meter attempts, sandbox time, language sessions, and egress; dashboard cost estimates include all AWS line items. Alarm at 50/80/100% of the $100 target; permit emergency disabling of new admissions while preserving drafts/results.

## Data and sessions

- Recovery: 750ms save debounce; IndexedDB recovery keyed by owner/workspace/version/language. Serialize session saves; monotonic server revision. History keeps up to 100 versions for 30 days; logout removes local owner data from the current browser.
- Submission source/public diagnostics: 30-day retention; match outcome metadata: 90 days. Keep hidden stdout/stderr out of user responses and application logs. Cleanup is versioned/configurable and tested.
- Invite: random 256-bit token, hash at rest, 24-hour expiry, exactly two seats; one active match per user. Host cannot change settings after a guest is ready without clearing readiness.
- Match finalization: two minutes from first entry into finalizing, never extended by retries/restarts. Pending work admitted before the deadline can affect the result; new submissions cannot.
- Auth session: seven-day maximum, secure HTTP-only cookie, server-side revocation. Application JWT: five-minute lifetime; refresh from valid session; enforce issuer/audience/algorithm/expiry. Logout prevents new JWTs; already-issued JWT revocation is bounded by five minutes unless subject/session is explicitly disabled.
- Language sessions: one active editor language session per owner, 30-minute idle expiry, 2 MiB maximum live document/workspace payload, bounded memory/process resources. Refresh/reconnect recreates the public workspace. Backend engine defaults must be benchmarked; deny cross-owner filesystem/cache sharing.

## Latency/load targets

Initial release test: 20 matches/40 language sessions connected for 15 minutes, including a 30-second burst of 2 submission requests/sec. Enforce per-owner quotas; report rejection rates separately rather than calling rejections successful throughput. Use at least 60 rotating fixture identities for the execution burst, with no more than 40 simultaneous coding sessions. Test queue saturation/failure separately.

- Warm API p95 ≤300ms excluding judge completion; cold-start/resume latency reported separately.
- Warm language completion/hover/signature p95 ≤300ms; diagnostics settle ≤1 second after idle; cold session usable ≤5 seconds.
- Local/live transport event-to-render p95 ≤500ms; reconnect/resync ≤5 seconds after network recovery.
- Reference-solution jobs: p95 queue wait ≤10 seconds and accepted-to-result ≤15 seconds at declared burst. Slow/hostile cases have separate timeout assertions. If this misses within cost constraints, document tradeoff before public release; do not change confirmed match rules to hide queue delays.
- Accessibility: WCAG AA contrast, keyboard workspace flow, 200% zoom, reduced motion; browser smoke tests in Chromium, Firefox, and WebKit. Desktop acceptance at 1280/1440px; narrow fallback at 390/768px.

No availability/SLA promise for the personal-project MVP. Track errors, outbox age, queue age, stalled leases, unauthorized access, language sessions/memory, and spend. Backups and an actual restore drill are public-release gates.

## Deployment

Local integration is the default environment. CI creates disposable databases/services; no always-on paid staging initially. Production workflow uses GitHub environment protection and a reviewed Terraform plan; migrations run once with a lock and forward-compatible rollout. Deploy API/auth/runner compatible with existing contracts before publishing dependent frontend assets. Keep previous images/assets for rollback; destructive schema migration is a separate deliberate change.
