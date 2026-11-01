# Durable dispatch and recovery

[Plan index](README.md)

Workers cannot own the current perpetual Go loops. Separate durable intent, wake delivery and bounded processing. Do not place reliable work solely in `waitUntil`, detached promises or in-memory timers; `waitUntil` has a bounded post-request lifetime. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

- Preserve PostgreSQL domain outboxes. Each mutation writes state and safe notice intent atomically; judge writes must participate too. Inventory trigger-owned writes before adding application events, avoiding duplicate emitters.
- Add a durable dispatch ledger only for missing execution/scheduling intents, with operation identity, availability and retry state. No queue payload becomes a job authorization or authoritative transition.
- Keep required durable execution prewake before admission while parity is established: wake failure admits no job; early/unused wakes are safe. After commit, request immediate dispatch. Consumers must cover the prewake-before-commit race with bounded admission grace and a durably scheduled continuation.
- A successful DB commit followed by failed queue send remains a successful committed command. Retrying the same key returns its result; never report a rollback that did not happen. Retain the unsent database intent for recovery.
- Drain in bounded batches with fenced/expiring dispatch claims. Publish before marking delivered. Duplicate publication is acceptable; lost intent is not. Recheck work arriving during drain before relinquishing the wake. Contention must not strand skipped locked rows.
- Recovery: scheduled server-side sweeper scans indexed pending intents/due deadlines and restarts exhausted dispatchers. Initially configure one-minute recovery, then measure actual hosted delay; this is a failure-repair bound target, not a precise timer guarantee. Immediate committed delivery uses awaited queue/DO wake, not the sweeper.
- Release gate: compare worst-case recovery/deadline delay with product operating requirements. If a minute-scale fallback is unacceptable, add a prearmed durable coordinator protocol and prove its commit-race recovery before activation; never silently weaken deadline semantics to fit Cron.
- Queue consumers acknowledge only after durable progress or a durable continuation. Publish failure retries the original message. Configure DLQs, alerting and explicit redrive; exhausted retries are not eventual recovery by themselves. [Queue retry semantics](https://developers.cloudflare.com/queues/configuration/batching-retries/).
- Node/local shells may keep direct PostgreSQL listeners as acceleration, with the same ledger, reconciliation and snapshot rules. Workers do not require a permanent Node notification bridge.
