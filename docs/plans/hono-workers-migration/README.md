# Hono and Workers migration

Implementation authorized on `feat/hono-migration`; production/main promotion remains separately gated. Adopt Hono/TypeScript and Drizzle ORM; PostgreSQL remains authoritative. Workers hosts API/auth/socket coordination; isolated execution stays behind provider-neutral ports. Full scope includes Go API, trusted judge, language gateway and tooling retirement. The active implementation goal authorizes the migration. KV/cache/search features remain excluded.

## Start here

1. [Scope and baseline](scope.md): constraints, ledger and branch drift.
2. [Architecture](architecture.md), [canonical owners](canonical-owners.md), [primitives](primitives.md): boundaries and refactoring decisions.
3. [Orchestration](orchestration/README.md): dispatch, file ownership, dependency graph and task packets.

Agents read their task packet plus its linked design documents, not every document by default. All paths inside packets are proposed repository-relative implementation ownership, not already-created source files.

## Design chunks

| Document | Responsibility |
| --- | --- |
| [HTTP/runtime](http-runtime.md) | Idiomatic Hono, middleware, configuration, portability |
| [Drizzle/database](database.md) | Schema ownership, transactions, migrations, query budgets |
| [Codecs](codecs.md) | Questions, exact numeric/byte/hash/UTF-16 semantics |
| [Auth](auth.md) | Better Auth, shared access policy, Worker dependencies |
| [Durable work](background.md) | Outboxes, wake races, claims, recovery |
| [Scheduling](scheduling.md) | Deadlines, alarms, retention |
| [Realtime](realtime.md) | Shared protocol, snapshots, DO/Node transports |
| [Execution](execution.md) | Trusted TS judge, isolation, language gateway |
| [Future extensions](extensions.md) | Cache/retrieval boundaries; no feature implementation |
| [Validation](validation.md) | Behavioral parity, concurrency, runtime and browser gates |
| [Rollout](rollout.md) | Coexistence, staging, cutover and rollback |
| [Completion](completion.md) | Removal, final audits and portability proof |

## Optimization requirements

Atomic commands; pure state transitions; canonical question/execution codecs; explicit safe read models; shared transaction/idempotency/dispatch/stream primitives; bounded database and judge resources; one realtime protocol engine; composition-owned configuration; current PostgreSQL query contracts with future decorator/retrieval seams.

Drizzle is required, replacing the earlier pg-only persistence decision. `pg` remains its driver. Existing SQL migration history is preserved. No ORM-driven schema redesign, extra microservices or permanent compatibility proxy.
