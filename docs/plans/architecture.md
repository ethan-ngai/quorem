# Architecture

## Structure

```text
apps/web/              React workspace; TanStack Router/Query; Vite+
apps/marketing/        Astro; deferred
apps/api/              Go HTTP entrypoints and application/domain packages
apps/auth/             Better Auth service; Cognito provider; application sessions/JWTs
apps/language/         Local language-service orchestration and pinned engine config
apps/runner/           Isolated judge worker entrypoint
packages/contracts/   OpenAPI/event schemas, generated TypeScript clients
packages/ui/          Shared CSS tokens/components when reuse exists
fixtures/problems/    Original/licensed, versioned seed problems
infra/terraform/      AWS resources, environments, reusable modules
docs/adr/             Confirmed decisions and migration triggers
docs/plans/           Domain specs and implementation handoffs
```

Baseline: modular Go application with separate runner process and TypeScript auth service required by Better Auth. Avoid microservices per domain initially. Each module owns rules and repository methods; adapters implement narrow ports. Share Go packages through a root module unless independent releases justify splitting. Application modules live under `apps/api/internal/{problems,workspace,judging,matches,identity,realtime}`; adapters under `apps/api/internal/adapters`; shared execution contracts under `internal/execution` at the Go module root, imported by API and runner.

## Boundaries

| Domain | Owns | Required ports |
| --- | --- | --- |
| Identity | User/session mapping, authorization | IdentityVerifier, UserRepository |
| Problems | Versioned statements, signatures, cases | ProblemRepository |
| Workspace | Draft versions, editor preferences | DraftRepository |
| Judging | Immutable submissions, job state, verdicts | JobQueue, ExecutionEngine, SubmissionRepository |
| Matches | Participants, deadlines, completion | MatchRepository, ProblemSelector, Clock |
| Realtime | Authorized fanout and resync | EventPublisher; separate browser transport |

Ports carry domain IDs/values and cancellation, never AWS SDK types. Avoid a generic repository/cache abstraction: define actual query and consistency needs. Cache is optional acceleration, never the initial source of truth. Events and execution jobs have different durability requirements; do not combine them into one PubSub interface.

## Proposed records

- `users`: internal ID, identity binding, display name, created timestamp.
- `problem_versions`: immutable ID, slug/version, statement, difficulty/tags, language signature, runtime/harness revision, visibility and limits.
- `test_cases`: version ID, public/hidden classification, encoded input/output, comparator metadata; server-only access to hidden data.
- `workspaces`: owner, problem version/language, solo or match namespace, optional match ID; unique solo owner/problem-version/language and match owner/match/language. `drafts`: unique workspace ID, source, revision, updated timestamp. `draft_versions`: workspace/revision history. Latest accepted save wins within its workspace only.
- `submissions`: owner, optional match ID, problem/runtime/harness versions, source snapshot, run/submit kind, state, verdict, timing, timestamps, idempotency key.
- `execution_jobs`: submission ID, attempts, lease expiry, availability timestamp; durable local PostgreSQL queue candidate.
- `matches`: state, version, immutable problem version, start/deadline, outcome; `match_participants`: seats and participant state.
- `outbox_events`: unique event ID, aggregate ID/version, payload schema version, delivery state.

Use foreign keys, uniqueness, transactions, explicit query indexes, and keyset pagination. Store timestamps in UTC. Auth schema migrations belong to Better Auth service; product schema migrations belong to Go persistence owner. No pgvector migration until selection is in scope. Exact fields/codec/error shapes are specified in contracts.md; retention in operating-defaults.md.

## HTTP contract overview

- `GET /v1/problems/{slug}`: public statement, templates, examples, limits, immutable version ID; no hidden cases.
- `GET/PUT /v1/workspaces/{workspaceId}/draft`: authenticated owner only; atomic revision assignment/history capture; latest accepted server save wins. Per-session save sequence prevents delayed writes from that session replacing a newer accepted write. Offline recovery requires explicit save/restore instead of automatic replay. Workspace namespaces separate solo and match source.
- `POST /v1/submissions`: authorized workspace ID, source snapshot, kind, optional public custom inputs; server derives owner/problem/language/match and enforces limits. Idempotency key; returns job ID/state. One nonterminal job per owner across instances; retry same key retrieves its existing job. Canonical fields: contracts.md.
- `GET /v1/submissions/{id}`: owner-scoped state, safe verdict details; poll fallback.
- Later: create/join/ready/leave match commands and authoritative match snapshot.

Use documented request size/rate limits, stable error codes and request IDs. Generate frontend types from reviewed schemas. Never trust frontend verdicts, participant IDs, clocks, or source ownership. Conflicting reuse of an idempotency key returns a conflict rather than silently reusing another request.

## Realtime and consistency

Application commits state/jobs/outbox in one transaction; external queue publish is never treated as part of that database transaction. Dispatcher relays events and execution messages with retry/reconciliation. Workers claim the authoritative application job lease before executing an SQS-delivered job; local PostgreSQL claim adapter obeys the same contract. Completion/heartbeat/cancellation go through restricted internal application commands with fenced attempt IDs; cloud runner has no direct domain DB mutation authority. Consumers deduplicate event IDs. Envelope: `eventId`, `schemaVersion`, `aggregateId`, `aggregateVersion`, `type`, `occurredAt`, safe payload. Treat transport as duplicating/dropping/reordering; snapshot recovery and version checks repair gaps.

Backend EventPublisher is provider-neutral; browser RealtimeTransport translates native WebSocket or AppSync protocol. Swapping providers also requires equivalent authentication/channel authorization; a server interface alone is insufficient. Clients may not publish authoritative verdicts or match transitions.

## Scaling path

Initial: one region, PostgreSQL, stateless API instances, bounded runner concurrency, indexed queries, durable jobs, backpressure. Confirmed public workload: 20 simultaneous matches/40 coding sessions and a 2 execution-request/sec burst; benchmark parameters and latency goals are in operating-defaults.md. One million registered users remains a growth target, not validated concurrency capacity.

Measure DB connections/query latency, oldest queued job, runner utilization, API latency/errors, active sockets, fanout, and spend. Add connection control, cache, distributed queue, partitioning, runner pools, or additional regions based on evidence. Preserve match-local serialization, retry safety, quotas, and admission control under horizontal scale. Load-test a declared workload; do not claim 1M-user readiness from interfaces alone.
