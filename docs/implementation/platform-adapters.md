# Provider boundaries

Work ledger: [#76](https://github.com/ethan-ngai/quorem/issues/76). PostgreSQL is the supported database on every deployment. No cloud resources are provisioned by this change.

## Structure

Application rules depend on domain values and consumer-owned ports. `httpapi.Repository` composes focused problem, question, execution, match and event contracts. `application` owns safe errors, IDs and hashes; DTOs live with their domains. HTTP handlers cannot import persistence or provider SDKs; an architecture test enforces this. `matches.Reconcile` evaluates ordered progress, deadlines and outcomes independently of SQL. PostgreSQL adapters own queries, locks, database clock sampling and atomic persistence/outbox writes. Admission/start SQL orchestration remains PostgreSQL-specific by design; PostgreSQL is a product requirement, not a cloud provider.

`worker.Repository` exposes authoritative claim/lease/complete/reconciliation operations; worker orchestration accepts this contract. `worker.Open` is a separate PostgreSQL composition facade for the runner. `ExecutionEngine` remains the sandbox boundary. Auth retains Better Auth and PostgreSQL, with SDK-free `EmailDelivery` and `ProfileStorage` ports. Neither Go identity verification nor product authorization requires Cognito; it is an upstream identity option.

Provider selection is per capability, not a global `CLOUD` switch. A Cloudflare frontend, AWS judge host, R2 avatars, SQS wakeups and external PostgreSQL are a valid composition. Runtime bindings and provider event handlers belong in deployment shells, not application rules. Domain interfaces describe the required semantics; adapters may use different protocols and topology.

| Capability          | Local                 | AWS                                                  | Cloudflare                                                            |
| ------------------- | --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| Database            | PostgreSQL            | PostgreSQL/Aurora connection                         | External PostgreSQL connection                                        |
| Job notifications   | DB polling            | SQS SDK                                              | Queues REST pull consumer                                             |
| Realtime fanout     | bounded memory        | AppSync Events HTTP + WebSocket                      | private Worker + Durable Object relay                                 |
| Avatar objects      | Garage S3             | S3                                                   | R2 S3 API                                                             |
| Transactional email | Mailpit SMTP          | SES SMTP                                             | outbound Email Service REST (beta; onboarding required)               |
| API/auth runtime    | Go/Node processes     | ordinary container/process                           | container/process candidate; Workers-native port unnecessary          |
| Judge sandbox       | bounded Docker engine | compatible isolated runner host, validation required | separate runner host; no nested-Docker or sandbox equivalence assumed |

Adapters are implemented for delivery, realtime, storage and email. Compute deployment and Terraform modules are separate work: a Cloudflare Container is not the Docker execution interface. Do not deploy untrusted judging there until process/filesystem/network/resource isolation and teardown are demonstrated. Keep the Go API/Node auth runtime instead of translating product logic into Worker code. A Worker connecting directly to PostgreSQL may need Hyperdrive; our Go process uses its normal PostgreSQL connection pool.

## Independent configuration

All omitted selections preserve `make dev`: memory fanout, PostgreSQL job polling, Garage avatars, Mailpit email. Cloud credentials are not loaded for unselected adapters. Auth details and examples: `apps/auth/README.md`, `apps/auth/.env.example`.

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

Queue adapters reject invalid bounded batches/receipts and redact provider failures. AWS uses its standard credential chain; Cloudflare API tokens need only the selected account/queue permissions. AppSync requires the `matches` channel namespace and server connect/publish/subscribe authorization. Cloudflare Queues requires an HTTP pull consumer; configure visibility/retry/DLQ per operational policy. Tokens and keys belong in deployment secrets, not Terraform state literals or frontend variables.

Cloudflare relay source is `apps/realtime-cloudflare`; Wrangler config declares its Durable Object binding and SQLite migration. Set its `RELAY_TOKEN` secret equal to the API relay token. Only API instances connect; clients use the existing Go WebSocket endpoint, with identity, origin, membership and periodic revocation checks. The relay sends notices only, never source, hidden cases, private snapshots or match transitions. Per-match socket bounds and per-message limits are enforced. Presence remains advisory and process-local; it cannot decide forfeits or outcomes. Shared presence, if required, needs a separate expiring lease adapter rather than changing fanout authority.

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
