# Realtime and polling audit

Tracked in [#262](https://github.com/ethan-ngai/quorem/issues/262). PostgreSQL remains authoritative. Browser streams carry authorized snapshots or invalidations; reconnects recover from durable state.

## Browser state

| Consumer           | Previous interval               | Event path                                                                         |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| Submission status  | 800 ms while judging            | Owner-authorized submission WebSocket, with an initial read and reconnect snapshot |
| Match              | 2 s disconnected, 5 s connected | Match WebSocket, with reconnect snapshots and version-gap recovery                 |
| Invitation preview | 5 s                             | Token-authorized invalidations, followed by a preview fetch                        |
| Current match      | 5 s                             | Shared owner membership WebSocket and authoritative refresh                        |
| Interview hub      | 10 s                            | Shared owner membership WebSocket and authorized list refresh                      |

## Backend scheduling and recovery

Match deadlines and job eligibility use database-clock one-shot timers and transactional notifications; startup and listener reconnection reconcile durable state. Outbox dispatch runs on commit signals with bounded retries on failures or lock contention. Runner cancellation uses one shared notification session plus fenced lease heartbeats.

Some bounded recovery work remains: match sockets periodically read an authoritative snapshot to recover a silently lost fanout event and recheck access; active submission sockets do the same at a slower cadence. On notification or database failures, reconnection and recovery retry with bounded delays. Membership and invitation streams reconnect when the transport fails but cannot detect a single silently dropped notice while it remains healthy; fully repairing that requires durable replay or a recovery read. The optional legacy Cloudflare REST queue adapter still pulls for work; the AWS SQS adapter uses queue receives. Production uses Cloudflare's push dispatch and HTTP drain. Replacing the legacy Cloudflare adapter requires a separately provisioned push consumer and migration for existing installations.

Lease renewal, presence renewal, WebSocket pings, authentication expiry, judge timeouts and retention cleanup are liveness or scheduled work. Container readiness and process supervision use bounded probes; CLI import and rollout retries are operational, not browser product-state feeds.

App scale-to-zero behavior is unchanged: overdue work catches up when the app next wakes. Local tests do not establish hosted throughput or latency.
