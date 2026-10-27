# Elastic production roles

GitHub Actions builds and verifies two independent images; Terraform provisions both container applications, the ingress Worker, native Queue and dead-letter Queue. Promotion to `main` remains a separate explicit action. Local validation never deploys account resources.

- **Application:** Go API, Node auth and nginx; no Docker daemon, judge binary or language images. Default 1 vCPU/3 GiB per instance. Four coordinator shards each admit two demand-created instances, at most eight total. Each instance bounds HTTP work to 32 requests and WebSockets to 512. Independent HTTP/socket ceilings fill existing instances before opening another; HTTP headroom remains available when sockets fill the pool. These are bounded concurrency slots, not throughput guarantees.
- **Judge:** Go runner only; no Docker daemon, auth service, API binary, auth secrets or invite key. Native Queue consumer concurrency and eight demand-created judge names bound each runtime revision to eight instances, each default 2 vCPU/6 GiB/two execution slots. Each case uses a separate disposable Cloudflare container and a language-specific image; expected answers and judge credentials stay in the controller. Old revisions can overlap while they drain. PostgreSQL separately bounds the global unfinished-job count to 200, including running work.

Application containers stop after ten idle minutes; judges retain their separate two-minute default. Browser shard affinity and persisted recent-use hints favor warm app capacity across catalog, auth and workspace requests. New visitors start at shard zero and overflow only when capacity fills, so low traffic shares warm capacity. Existing affinity cookies remain valid. Capacity-full fallback refreshes affinity, while failed application requests never replay. Warm hints are bounded, advisory and expire with the idle grace; they cannot bypass admission or authorization. Open accepted WebSockets keep applications alive. HTTP/socket leases renew every 15 seconds; persisted TTLs and cleanup alarms repair coordinator crashes. An idle-stop promise fences new arrivals until destruction finishes, then shares one cold-start readiness check. Warm requests do not run health probes. Failed application commands never replay automatically. WebSocket upgrade timers clear on acceptance and impose no established-connection lifetime limit.

Public login capabilities are projected from validated auth configuration into an allowlisted Worker binding. This GET returns immediately and warms the backend in the background while credentials are entered; local auth uses the same projection. App placement is constrained to ENAM, near the US-east PostgreSQL database. The fast judge policy does not support regional constraints; its ENAM Durable Object hint is advisory. Auth primes its bounded query pool at startup, loads only selected delivery/storage adapters and imports native image processing on upload. Database connect, statement and read timeouts bound stalled auth requests. `Server-Timing: app` reports backend dispatch latency; container readiness logs report startup duration without credentials.

Scale-to-zero trades idle cost for cold startup: the first application request waits for API/auth readiness; the first execution after judge sleep waits for authenticated case-service connectivity and database connection. Judge and case containers use Cloudflare's Durable Object scheduling policy with prepared, digest-pinned images; the application stays on its existing policy. Successful private workspace, match and interview reads prewarm one judge in the background; queue drains prefer that judge when available and route concurrent work across the remaining slots. The judge still stops after its idle grace. Deployment runs hosted behavioral and SQL isolation probes. Startup logs report database and case-service check durations. Judge idle grace (`judge_idle_ms`, default 120000) can extend to ten minutes when lower tail latency justifies idle cost. Capacity, CPU and memory bounds are Terraform variables; judge memory is capped at 12 GiB and requires at least 3 GiB per vCPU. Native Queue controls delivery concurrency; the Worker explicitly routes bounded application/judge demand.

Terraform creates a separate fast judge application and retains the prior application during cutover. Because the pinned Cloudflare provider omits named-image Worker metadata, a Terraform-owned upload step resolves the registry tag to a digest, waits for image preparation, uploads the full Worker version and deploys it. New judge names include the image and runtime configuration fingerprint; older instances drain and stop independently. Cloudflare's fast scheduling policy is beta; local workerd tests do not establish hosted isolation or startup latency.

## Durable execution wake

Before committing admission, the API POSTs `{jobId}` to `/internal/judge/wake` using `QUOREM_JUDGE_CONTROL_TOKEN`. Ingress validates the token and message allowlist and awaits native `JUDGE_WAKE.send()` before returning 202. Messages contain no source, cases, expected values or credentials. Admission is bounded to ten seconds; the judge must observe a 15-second quiet grace before acknowledging a globally empty queue.

The Queue consumer coalesces up to 100 already-published valid wakes into one judge Durable Object call, with zero batching wait for the first wake. This prevents stale wake backlogs from keeping an empty fleet alive one 15-second grace per message. Each arrival advances its drain generation; an arrival during a pending drain waits for another drain afterward. The consumer acknowledges only an HTTP 200 with `{queued:0,running:0}`. Pending, malformed and unavailable responses retry with bounded backoff (2–30 seconds). Twenty failed deliveries route to the dead-letter Queue, retained for four days. Provisioning the DLQ is not an alert/redrive operator: inspect and redrive it after a sustained outage; a new valid wake can also drain pending authoritative jobs. Queue messages remain durable during judge cold starts and crashes.

Judge `/health` and authenticated `/internal/drain` use port 8090. Drain calls are bounded to 240 seconds; handlers remain below Queue's 15-minute wall limit. Case output streams back over an authenticated private Worker route. A terminal frame follows confirmed container destruction; cancellation durably fences the attempt against late starts. Failed teardown retains PostgreSQL lease fencing and recovery semantics.

## Database and secrets

### Purelymail and social login

Production auth settings come from repository configuration, validated by `scripts/configure-production-auth.ts` before Terraform applies. Configured SMTP must pass a TLS/authentication check; this sends no email. Set secrets with `gh secret set NAME` or GitHub's repository secrets UI; never commit credentials or pass them on a command line. Until email is fully configured, deployment preserves login-only mode. Partial SMTP or OAuth credentials fail deployment before mutation.

| Repository configuration | Purpose |
| --- | --- |
| Secret `SMTP_USERNAME` | Full Purelymail mailbox address |
| Secret `SMTP_PASSWORD` | Purelymail app password |
| Variable `AUTH_EMAIL_FROM` | `Quorem <noreply@quorem.app>` |
| Secrets `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | Google web OAuth client |
| Secrets `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth app |

Register `https://quorem.app/api/auth/callback/google` for Google's web OAuth client and `https://quorem.app/api/auth/callback/github` for GitHub's OAuth app. Existing password accounts must sign in and explicitly link providers in Settings; matching email addresses never implicitly link accounts. Apple remains disabled: its web setup requires a developer account, Services ID and associated primary App ID ([Apple requirements](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)).

Purelymail uses `smtp.purelymail.com:465` with implicit TLS and certificate verification. Complete Purelymail's domain ownership/SPF/DKIM setup before activating a custom-domain sender; preserve existing mail records rather than replacing unrelated services. Mailbox creation and provider console registration require their account owners. Setting all three mail values enables registration, verification and password recovery. Auth settings enter only the application's secret Worker binding; judges receive none. A hash of each role's runtime configuration triggers its container rollout on secret-only changes, without exposing secret values in container configuration.

Provider setup: [Purelymail SMTP](https://purelymail.com/docs/setup/technical), [Purelymail domains](https://purelymail.com/docs/domainDocs), [Better Auth OAuth callbacks](https://www.better-auth.com/docs/concepts/oauth).

Application PostgreSQL pools default to four connections and auth pools to four. The PostgreSQL realtime publisher and three dedicated listeners bring the application budget to 12 connections per instance, up to 96 across eight applications. Eight active judges add at most 16 query connections and eight dedicated execution listeners: 120 steady-state connections before deployment/migration overhead. Neon max compute defaults to 4 CU; the deployed account uses a 2-CU ceiling through `NEON_MAX_COMPUTE_CU`. Suspension uses the account default (`0`, normally five minutes), because this account rejects explicit suspend-interval overrides. Terraform applies compute bounds instead of ignoring them. Validate provider connection/cost limits for the declared workload before promotion.

Terraform generates a sensitive 64-character judge control token. Only the application runtime and private Worker/judge boundary receive it; case containers receive neither that token nor the database URL. Schema migrations, provisioning and bootstrap run once in GitHub Actions before rollout; cold starts skip migrations. The application rollout and the active Worker's judge/case image digests and bindings are checked before production probes pass. After rollout, GitHub Actions publishes one durable `deployment-reconcile` wake to the nonsecret Terraform queue ID using the existing scoped deployment token. This recovers queued or leased jobs without requiring another submission or a periodic keep-alive cron. Failed publication fails deployment; safe duplicate wakes may retry. No judge control token is exported to the workflow.

## Local verification

```sh
node --import ./deploy/test-register.mjs --test deploy/*.test.mjs
vp -C apps/realtime-cloudflare exec wrangler dev --config ../../deploy/wrangler.test.jsonc --port 8791 --ip 127.0.0.1
# In another terminal: real workerd + local Docker fixture, no account credentials.
node deploy/workerd-check.mjs
python3 scripts/test-direct-sandbox.py
QUOREM_TEST_DIRECT_DOCKER=1 go test ./apps/runner/internal/engine -run TestRemoteSandboxPreflightWithDocker -count=1
```

The workerd fixture checks HTTP, authenticated durable Queue publication, accepted WebSocket echo/subprotocol, pressure scale-out, renewal beyond the lease TTL, and the direct case transport. CI additionally validates Terraform, image role separation, and runs the real direct launcher and runner preflight in disposable privileged Docker containers. Local workerd/Docker proof is not production account rollout or workload/cost validation.

Primary runtime contracts: [Cloudflare container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), [container WebSockets](https://developers.cloudflare.com/containers/examples/websocket/), [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

Neon suspension semantics: [official API guidance](https://github.com/neondatabase/ai-rules/blob/main/neon-api-projects.mdc) (`0` uses the default 300 seconds; `-1` disables suspension).
