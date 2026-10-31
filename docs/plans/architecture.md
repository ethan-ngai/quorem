# Architecture

Quorem uses a modular Hono/TypeScript backend with Drizzle and PostgreSQL. The same application runs natively in Cloudflare Workers or a portable Node process. Runtime shells select capability adapters; domain rules do not depend on a cloud provider.

| Owner | Responsibility |
| --- | --- |
| `apps/api/src/modules` | Identity/access, problems, workspaces, submissions, matches and interviews |
| `apps/api/src/application` | Shared transaction, cancellation, errors and application primitives |
| `apps/api/src/adapters` | PostgreSQL repositories, identity, delivery and event implementations |
| `apps/api/src/runtime` | Node/Workers composition, HTTP/queue/scheduled entrypoints and sockets |
| `apps/auth/src` | Better Auth factory, sessions, email and profile ports; embedded in Hono |
| `apps/runner/src` | Trusted TypeScript judge, independent verifier and sandbox adapters |
| `apps/language/src` | Portable TypeScript language gateway |
| `packages/database` | Drizzle schema, PostgreSQL connection/transaction and migration owners |
| `packages/questions`, `packages/execution` | Canonical codecs, publication and execution contracts |
| `packages/contracts` | Reviewed public contracts and generated browser clients |

Handlers depend on focused application ports. PostgreSQL adapters own queries, locks and atomic persistence; ORM rows do not become browser payloads. Shared behavior belongs in canonical codecs, transaction/idempotency, dispatch, streaming and socket primitives. Consumer-specific differences remain explicit.

PostgreSQL is authoritative on every deployment. Admission commits immutable inputs, quota/idempotency state, jobs and durable intents atomically. Wakeups accelerate durable work; they do not authorize claims or determine results. Claims, heartbeats, cancellation, checkpoints and completion use attempt fencing. External publication follows commit and retries independently.

Browsers use one authorized WebSocket protocol across Node and Durable Objects. Notices trigger scoped authoritative snapshots; receipt acknowledgements, versions and reconnect repair transport loss or duplication. Interview documents retain epoch/version checks and server-controlled stage advancement. Hidden tests, private interview data and opponent source stay behind their authorization owners.

Node uses request/operation-bounded PostgreSQL connections. Workers uses Hyperdrive and native queue/scheduled entrypoints; Durable Objects own socket and alarm coordination. Trusted judging and verification remain outside the public API process behind explicit ports. Cloudflare case containers and local Docker are distinct adapters with independently validated isolation.

Product and auth keep separate schemas and checksummed ledgers under the shared migration owner. Retained data normalization uses audited operator commands; migrations never silently replace history. Runtime roles do not own schemas, migration ledgers or recovery records.

Provider configuration is independent per capability; see [platform adapters](../implementation/platform-adapters.md). Cache and semantic retrieval remain future extensions behind focused query/retrieval contracts. No KV cache, embedding pipeline or vector index is implemented by this migration.

Local development uses fixtures and requires no cloud credentials. Infrastructure is provisioned with Terraform and deployed through GitHub Actions. Native staging, production traffic cutover and production readiness are separate claims; inspect the actual deployment evidence before asserting release state.
