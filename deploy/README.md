# Elastic production roles

GitHub Actions builds and verifies two independent images; Terraform provisions both container applications, the ingress Worker, native Queue and dead-letter Queue. Promotion to `main` remains a separate explicit action. Local validation never deploys account resources.

- **Application:** Go API, Node auth and nginx; no Docker daemon, judge binary or language images. Default 1 vCPU/3 GiB per instance. Four coordinator shards each admit two demand-created instances, at most eight total. Each instance bounds HTTP work to 32 requests and WebSockets to 512. Independent HTTP/socket ceilings fill existing instances before opening another; HTTP headroom remains available when sockets fill the pool. These are bounded concurrency slots, not throughput guarantees.
- **Judge:** Docker daemon, isolated language images and Go runner only; no auth service, API binary, auth secrets or invite key. Native Queue consumer concurrency and eight stable demand-created judge names cap the fleet at eight instances, each default 2 vCPU/6 GiB/two execution slots. The default bound is 16 active executions; PostgreSQL separately bounds the global unfinished-job count to 200, including running work. This does not promise unlimited execution throughput.

Both roles stop after two idle minutes by default. Open accepted WebSockets keep applications alive. HTTP/socket leases renew every 15 seconds; persisted TTLs and cleanup alarms repair coordinator crashes. An idle-stop promise fences new arrivals until destruction finishes, then shares one cold-start readiness check. Warm requests do not run health probes. Failed application commands never replay automatically. WebSocket upgrade timers clear on acceptance and impose no established-connection lifetime limit.

Scale-to-zero trades idle cost for cold startup: the first application request waits for API/auth readiness; the first execution after judge sleep waits for Docker startup, language-image loading and the real sandbox preflight. Hashing a new Queue message to one of eight judge names may select a cold judge even if another remains warm. Judge idle grace (`judge_idle_ms`, default 120000) can extend to ten minutes when lower tail latency justifies idle cost. Capacity, CPU and memory bounds are Terraform variables; memory validation enforces Cloudflare’s minimum 3 GiB per vCPU for the supported 1–4 vCPU sizes; no cloud autoscaling is assumed for Containers. Native Queue controls delivery concurrency; the Worker explicitly routes bounded application/judge demand.

## Durable execution wake

Before committing admission, the API POSTs `{jobId}` to `/internal/judge/wake` using `QUOREM_JUDGE_CONTROL_TOKEN`. Ingress validates the token and message allowlist and awaits native `JUDGE_WAKE.send()` before returning 202. Messages contain no source, cases, expected values or credentials. Admission is bounded to ten seconds; the judge must observe a 15-second quiet grace before acknowledging a globally empty queue.

The Queue consumer coalesces up to 100 already-published valid wakes into one judge Durable Object call, with zero batching wait for the first wake. This prevents stale wake backlogs from keeping an empty fleet alive one 15-second grace per message. Each arrival advances its drain generation; an arrival during a pending drain waits for another drain afterward. The consumer acknowledges only an HTTP 200 with `{queued:0,running:0}`. Pending, malformed and unavailable responses retry with bounded backoff (2–30 seconds). Twenty failed deliveries route to the dead-letter Queue, retained for four days. Provisioning the DLQ is not an alert/redrive operator: inspect and redrive it after a sustained outage; a new valid wake can also drain pending authoritative jobs. Queue messages remain durable during judge cold starts and crashes.

Judge `/health` and authenticated `/internal/drain` use port 8090. Drain calls are bounded to 240 seconds; handlers remain below Queue's 15-minute wall limit. The judge supervisor stops the runner first and preserves Docker for up to 30 seconds of attempt teardown before stopping the daemon. Failed teardown retains PostgreSQL lease fencing and recovery semantics.

## Database and secrets

Application PostgreSQL pools default to four connections and auth pools to four. The PostgreSQL realtime publisher and three dedicated listeners bring the application budget to 12 connections per instance, up to 96 across eight applications. Eight active judges add at most 16 query connections and eight dedicated execution listeners: 120 steady-state connections before deployment/migration overhead. Neon max compute defaults to 4 CU; the deployed account uses a 2-CU ceiling through `NEON_MAX_COMPUTE_CU`. Suspension uses the account default (`0`, normally five minutes), because this account rejects explicit suspend-interval overrides. Terraform applies compute bounds instead of ignoring them. Validate provider connection/cost limits for the declared workload before promotion.

Terraform generates a sensitive 64-character judge control token. Only the application runtime and private Worker/judge boundary receive it; the judge receives only its database URL and control token. Schema migrations, provisioning and bootstrap run once in GitHub Actions before the role rollouts; cold starts skip migrations. Both exact target rollout IDs and image revisions must finish before production probes pass. After both role rollouts, GitHub Actions publishes one durable `deployment-reconcile` wake to the nonsecret Terraform queue ID using the existing scoped deployment token. This recovers queued or leased jobs inherited from the old polling runtime without requiring another user submission or a periodic keep-alive cron. Failed publication fails deployment; safe duplicate wakes may retry. No judge control token is exported to the workflow.

## Local verification

```sh
node --import ./deploy/test-register.mjs --test deploy/*.test.mjs
vp -C apps/realtime-cloudflare exec wrangler dev --config ../../deploy/wrangler.test.jsonc --port 8791 --ip 127.0.0.1
# In another terminal: real workerd + local Docker fixture, no account credentials.
node deploy/workerd-check.mjs
```

The workerd fixture checks HTTP, authenticated durable Queue publication, accepted WebSocket echo/subprotocol, pressure scale-out and renewal beyond the lease TTL. CI additionally validates both Terraform modules, checks image role separation, and runs the actual judge image with privileged nested Docker to prove per-case isolation, limits and teardown. Local workerd/Docker proof is not production account rollout or workload/cost validation.

Primary runtime contracts: [Cloudflare container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), [container WebSockets](https://developers.cloudflare.com/containers/examples/websocket/), [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

Neon suspension semantics: [official API guidance](https://github.com/neondatabase/ai-rules/blob/main/neon-api-projects.mdc) (`0` uses the default 300 seconds; `-1` disables suspension).
