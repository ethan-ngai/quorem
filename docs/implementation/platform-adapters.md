# Provider boundaries

Work ledger: [#76](https://github.com/ethan-ngai/quorem/issues/76). PostgreSQL is the supported database on every deployment. No cloud resources are provisioned by this change.

## Structure

Application rules depend on domain values and consumer-owned ports. `httpapi.Repository` composes focused problem, question, execution, match and event contracts. `application` owns safe errors, IDs and hashes; DTOs live with their domains. HTTP handlers cannot import persistence or provider SDKs; an architecture test enforces this. `matches.Reconcile` evaluates ordered progress, deadlines and outcomes independently of SQL. PostgreSQL adapters own queries, locks, database clock sampling and atomic persistence/outbox writes. Admission/start SQL orchestration remains PostgreSQL-specific by design; PostgreSQL is a product requirement, not a cloud provider.

`worker.Repository` exposes authoritative claim/lease/complete/reconciliation operations; worker orchestration accepts this contract. `worker.Open` is a separate PostgreSQL composition facade for the runner. `ExecutionEngine` remains the sandbox boundary. Auth retains Better Auth and PostgreSQL, with SDK-free `EmailDelivery` and `ProfileStorage` ports. Neither Go identity verification nor product authorization requires Cognito; it is an upstream identity option.

Provider selection is per capability, not a global `CLOUD` switch. A Cloudflare frontend, AWS judge host, R2 avatars, SQS wakeups and external PostgreSQL are a valid composition. Runtime bindings and provider event handlers belong in deployment shells, not application rules. Domain interfaces describe the required semantics; adapters may use different protocols and topology.

| Capability          | Local                               | AWS                                                  | Cloudflare                                                                |
| ------------------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Database            | PostgreSQL                          | PostgreSQL/Aurora connection                         | External PostgreSQL connection                                            |
| Job notifications   | PostgreSQL notifications + recovery | SQS SDK                                              | Native Queues push to on-demand judge; legacy REST pull adapter available |
| Realtime fanout     | bounded memory                      | AppSync Events HTTP + WebSocket                      | PostgreSQL safe notice fanout; optional private Durable Object relay      |
| Avatar objects      | Garage S3                           | S3                                                   | R2 S3 API                                                                 |
| Transactional email | Mailpit SMTP                        | SES SMTP                                             | outbound Email Service REST (beta; onboarding required)                   |
| API/auth runtime    | Go/Node processes                   | ordinary container/process                           | container/process candidate; Workers-native port unnecessary              |
| Judge sandbox       | bounded Docker engine               | compatible isolated runner host, validation required | separate runner host; no nested-Docker or sandbox equivalence assumed     |

Adapters are implemented for delivery, realtime, storage and email. Compute deployment is implemented in separate deployment shells and Terraform modules; a Cloudflare Container is not the Docker execution interface. Do not deploy untrusted judging there until process/filesystem/network/resource isolation and teardown are demonstrated. Keep the Go API/Node auth runtime instead of translating product logic into Worker code. A Worker connecting directly to PostgreSQL may need Hyperdrive; our Go process uses its normal PostgreSQL connection pool.

## Independent configuration

All omitted selections preserve `make dev`: memory fanout, PostgreSQL job notifications with recovery polling, Garage avatars, Mailpit email. Cloud credentials are not loaded for unselected adapters. Auth details and examples: `apps/auth/README.md`, `apps/auth/.env.example`.

```sh
# Notification transport; set consistently on API and runner.
QUOREM_DELIVERY_PROVIDER=aws-sqs
AWS_SQS_QUEUE_URL=https://sqs.REGION.amazonaws.com/ACCOUNT/QUEUE
AWS_REGION=REGION
# Or:
QUOREM_DELIVERY_PROVIDER=cloudflare-queues
CLOUDFLARE_ACCOUNT_ID=ACCOUNT_ID
CLOUDFLARE_QUEUE_ID=QUEUE_ID
CLOUDFLARE_API_TOKEN=SERVER_ONLY_SECRET

# API fanout; subscriptions remain behind the Go authorization endpoint.
QUOREM_REALTIME_PROVIDER=aws-appsync
AWS_APPSYNC_HTTP_URL=https://API.appsync-api.REGION.amazonaws.com/event
AWS_APPSYNC_WS_URL=wss://API.appsync-realtime-api.REGION.amazonaws.com/event/realtime
AWS_REGION=REGION
# Default credential chain / workload role, scoped to publish, subscribe and connect.
# AWS_APPSYNC_API_KEY is an optional server-only alternative; never return it to browsers.
# Or:
QUOREM_REALTIME_PROVIDER=cloudflare-durable-objects
CLOUDFLARE_REALTIME_URL=https://YOUR_PRIVATE_RELAY.workers.dev
CLOUDFLARE_REALTIME_TOKEN=AT_LEAST_32_RANDOM_CHARACTERS
```

Queue adapters reject invalid bounded batches/receipts and redact provider failures. AWS uses its standard credential chain; Cloudflare API tokens need only the selected account/queue permissions. AppSync requires the `matches`, `match-invites`, `interviews`, `memberships`, and `submissions` channel namespaces and server connect/publish/subscribe authorization. Cloudflare Queues requires an HTTP pull consumer; configure visibility/retry/DLQ per operational policy. Tokens and keys belong in deployment secrets, not Terraform state literals or frontend variables.

Cloudflare relay source is `apps/realtime-cloudflare`; Wrangler config declares its Durable Object binding and SQLite migration. Set its `RELAY_TOKEN` secret equal to the API relay token. Only API instances connect; clients use the existing Go WebSocket endpoint, with identity, origin, membership and periodic revocation checks. Invitation preview notices use the separate `match-invites` namespace; AppSync deployments must configure it alongside `matches` and `interviews`. The relay sends notices only, never source, hidden cases, private snapshots or match transitions. Per-match socket bounds and per-message limits are enforced. Presence remains advisory and process-local; it cannot decide forfeits or outcomes. Shared presence, if required, needs a separate expiring lease adapter rather than changing fanout authority.

## Delivery semantics

- Admission commits submission, job, quotas and idempotency in PostgreSQL before publishing a wakeup. The internal execution job ID is never serialized in public submission responses.
- Queue messages are optional wakeups, not authoritative jobs. The worker ignores their requested job identity and uses PostgreSQL claim/attempt fencing. Duplicate or lost notifications cannot select a job or duplicate its completion; database polling repairs wakeup loss. Publish/ack failures do not roll back committed application state.
- Local polling stays at 200ms; configured cloud queues retain a 5-second recovery poll. This makes best-effort post-commit notifications safe without pretending a broker send participates in a database transaction. A future queue-owned execution model would require a durable dispatch outbox, not just removal of polling.
- Match events already use a transactional outbox: publish before marking sent. Failure retries; partial AppSync failures are rejected. Consumers coalesce notices and read authorized authoritative snapshots. Event IDs/aggregate versions repair duplicates, gaps and ordering.
- Remote event subscriptions close on transport/protocol failure; the browser reconnects and retains REST recovery. AppSync's advertised keepalive timeout is honored. Relay credentials stay server-side, TLS is required except loopback fixtures, redirects are rejected, and request/read sizes and operation lifetimes are bounded.

## Validation and release gates

Contract tests use fake AWS SDK clients and official-protocol HTTP/WebSocket servers. Go tests cover provider envelope/auth mapping, partial failure, redirects, cancellation and invalid input; worker tests cover wakeup-to-DB-claim, teardown and stale attempts. PostgreSQL tests must use a separate disposable database. Auth tests include R2 SDK mapping, email acceptance/errors, production opt-in and seed restrictions.

Local native Durable Object roundtrip:

```sh
vp -C apps/realtime-cloudflare exec wrangler dev --ip 127.0.0.1 --port 8787 --var RELAY_TOKEN:local-contract-test-token-at-least-32-chars
# Separate terminal:
QUOREM_RELAY_TEST_URL=http://127.0.0.1:8787 \
QUOREM_RELAY_TEST_TOKEN=local-contract-test-token-at-least-32-chars \
go test -race ./apps/api/internal/adapters/eventbus
```

This is local workerd execution, not cloud validation. Live cloud account/IAM/namespace/email-domain tests, infrastructure provisioning, load/cost measurements, sandbox isolation and deployment approval remain release gates. Cloudflare outbound email beta availability is a capability gate; use SES or other TLS SMTP when unavailable. Unsupported combinations fail configuration rather than silently changing semantics.

Primary protocol references: [AppSync Events HTTP](https://docs.aws.amazon.com/appsync/latest/eventapi/publish-http.html), [AppSync WebSockets](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html), [Cloudflare Queues pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/), [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [Cloudflare outbound email](https://developers.cloudflare.com/email-service/get-started/send-emails/).

## Interview WebSockets

Tracked in [#137](https://github.com/ethan-ngai/quorem/issues/137). Browsers use the authenticated, bidirectional `GET /v1/interviews/{id}/events` WebSocket on every provider. Commands: `pull`, `push`, `presence`, `peers`, `snapshot`, `submission`; each includes a request `id`, responses echo it. `push` retains its idempotency `key` across reconnects and carries the CodeMirror `{epoch,version,updates}` object. Recovery drains versioned updates in bounded batches, rebases pending local edits, then retries. No recurring document, presence-read, session or result HTTP polling. Selection changes send presence; a 10-second socket heartbeat renews advisory leases. Unsaved edits survive disconnects in the mounted editor, not browser shutdown.

PostgreSQL remains the document authority. The product schema baseline atomically queues safe document/presence/session/result notices, including judge writes. PostgreSQL LISTEN/NOTIFY wakes dispatch immediately after commit; a one-second outbox recovery tick repairs missed notifications; each wake drains pending batches immediately. Dispatchers retry publication before acknowledging. Distinct coalesced notices become an all-state wakeup, preventing a cursor event from hiding a document or role change. The API reloads authorized state before returning private data; browser sockets recheck membership on commands, notices and heartbeats. Successful bearer/guest credential checks are shared for at most two seconds per socket, capped at bearer expiry; failures are never cached. Document commands and advisory reads have separate bounded serial lanes, with transport heartbeat work independent of database command processing. Reads use consistent snapshots without exclusive document locks; document mutations retain ordered row locks. Presence serializes only each actor's window quota. Heartbeats also repair lost notices. Socket queues, frames, commands and connections are bounded. Browsers rotate sockets before bearer expiry and reconnect stalled transports after 25 seconds without frames; individual RPC timeouts do not close a healthy transport. Mounted pending edits retain their retry keys through rotation/reconnect.

Both cloud adapters accept `/interviews/{uuid}` alongside `/matches/{uuid}`. AppSync deployments must configure an `interviews` channel namespace and server-only connect/publish/subscribe permissions, in addition to `matches`. Cloudflare uses the same private Worker/Durable Object relay and token configuration above. Provider sockets carry notice identities only; source, tests and credentials stay on the authorized API connection. API/auth still need a Go/Node process or container host; the relay does not port the API to Workers.

Validation: cross-instance Go API tests with real PostgreSQL, AppSync HTTP/WebSocket protocol fixtures, and the actual local Wrangler/workerd relay; browser controller tests cover concurrent rebasing, lost acknowledgments, bounded offline batches, epoch fencing, and socket lifecycle recovery. Live AWS/Cloudflare account deployment and workload latency/cost validation remain separate release gates.

Interview monitoring (#144): `rule-event` socket commands carry `key` and `kind` (`paste` or `focus`), never clipboard text. The server checks current interviewee membership, active state and host monitoring settings; retries are idempotent and reports are bounded per actor/kind. Event insertion, the session version and existing transactional session notice commit together. Only current interviewers receive the most recent 100 events in snapshots. Host-only `POST /v1/interviews/{id}/monitoring` changes policies without changing document/question epochs. Existing sessions default to both monitors enabled. The browser reuses match focus deduplication, exempts recent same-tab copy/cut fingerprints, and retains a bounded in-memory retry queue while reconnecting.

Interview database notifications use a dedicated PostgreSQL session outside the query pool. Transaction-pooling endpoints cannot retain `LISTEN` state. Set `QUOREM_DATABASE_LISTEN_URL` to a session-capable direct endpoint when needed; Neon `-pooler` endpoints automatically select their matching direct hostname while preserving TLS verification. No credentials are logged. Slow socket commands log only their bounded command type and duration; socket close logs contain codes and safe reason categories.

## Elastic app and judge composition (#194)

The deployed Cloudflare app uses `QUOREM_REALTIME_PROVIDER=postgres-notify`: dedicated session-capable listeners broadcast safe notices to every app replica. Private snapshots remain on authenticated Go sockets. A lost fanout listener closes its subscriptions; clients reconnect and recover versioned state. Expiring PostgreSQL presence leases enforce the per-user window quota across replicas. Match and interview outbox dispatch use commit notifications with bounded recovery ticks. Each app schedules the earliest database-clock match deadline after subscribing to transactional deadline notifications. Startup and listener reconnection reconcile overdue deadlines; notification outages retain a bounded recovery scan. Simultaneous replicas lock due rows with SKIP LOCKED. An idle container can still stop; overdue deadlines are recovered when an app next starts, as with the previous reconciliation loop.

`QUOREM_DATABASE_MAX_CONNS` bounds each Go query pool (default 4; judge deployment 2); `AUTH_DATABASE_MAX_CONNS` bounds Node auth pools (default 4). Pools retain no minimum idle connections. Each app also uses six dedicated notification sessions and at most one fanout publishing connection: the default deployment ceiling is 15 connections per app replica, plus judge pools and migration/operator headroom. Neon pooled query connections and direct notification sessions have different limits; verify both in the hosted plan. `QUOREM_API_MAX_REQUESTS=32` and `QUOREM_REALTIME_CONNECTION_LIMIT=512` bound independent request/socket budgets. Overload returns retryable 503 responses.

Submission status uses an owner-authorized `/v1/submissions/{id}/events` socket. The server subscribes before reading the initial snapshot; reconnect repeats that snapshot. State changes enqueue safe notices transactionally, and outbox recovery retries failed delivery. A 30-second authoritative read on the live socket repairs silently lost notices. Browsers stop the socket after a terminal result. AppSync requires a `submissions` namespace, and each app adds one dedicated PostgreSQL notification session for submission notices.

Production images set `QUOREM_SKIP_MIGRATIONS=true`; deployment applies migrations once before replacing containers. Cold replicas skip migration and retention scans. Local startup and explicit `--seed` retain migration behavior.

Required judge wakes use `QUOREM_DELIVERY_PROVIDER=cloudflare-dispatch`, `QUOREM_EXECUTION_WAKE_URL` and the scoped `QUOREM_JUDGE_CONTROL_TOKEN`, with `QUOREM_REQUIRE_EXECUTION_WAKE=true`. The API durably publishes a wake before its bounded admission transaction. A failed wake admits no job; an unused wake safely drains an empty queue. Queue consumers wake independent judge containers and acknowledge only an authenticated drain response reporting no queued/running jobs. PostgreSQL owns claim leases, fencing and results; native Queues own delivery and waking compute from zero. The dispatch credential cannot administer Cloudflare resources.

An HTTP-mode judge starts no idle polling/listener; `runner --http` drains with bounded concurrency when invoked. Admission grace and overlapping-wake extension cover notifications that arrive before the job commits. Continuous local runners instead use transactional PostgreSQL notifications with recovery polling. Idle app/judge containers may stop, and idle database compute may suspend; active sockets or jobs require compute. Stored data persists. Cold starts add latency, so scale-to-zero cannot promise a warm-instance response time.

Provider deployment, nested sandbox isolation under the hosted runtime, account quotas and representative production load remain validation gates. Local multi-replica socket tests exercise application correctness; they do not establish hosted throughput or zero-cost storage.


Current-match discovery uses an authenticated owner-scoped WebSocket. Committed reservation and match changes enqueue private invalidation notices; each reconnect reloads the authoritative current match. Event payloads carry no membership or source data. PostgreSQL and provider outage recovery remain authoritative through the outbox.
