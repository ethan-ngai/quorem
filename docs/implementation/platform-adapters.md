# Provider boundaries

PostgreSQL remains authoritative. Hono domain/application modules depend on consumer-owned ports; provider SDKs, runtime bindings and event envelopes belong in adapters and composition. Select capabilities independently rather than using a global cloud switch.

| Capability | Local / portable Node | Cloudflare | Other implemented adapters |
| --- | --- | --- | --- |
| Database | PostgreSQL with Drizzle/pg | PostgreSQL through Hyperdrive | Ordinary hosted PostgreSQL |
| Job wakeups | Local protocol fixture or selected queue consumer | Native Queues handler | SQS; Cloudflare REST pull for Node |
| Browser sockets | Native Node WebSockets | Durable Objects | Same shared protocol and authorization |
| Notice fanout | Bounded memory | Durable Object fanout | AppSync Events |
| Profile storage | Garage S3 | R2 | S3 |
| Email | Mailpit SMTP | Selected external email adapter | SMTP/SES SMTP; Cloudflare email REST |
| Execution | Trusted TS runner/verifier and Docker case adapter | Separate trusted services and remote case adapter | Any sandbox implementation satisfying the execution port |
| Language gateway | TypeScript process/container | Independent configured service | Provider-neutral HTTP/WebSocket gateway |

API/auth run together in native Hono. The portable API image is `deploy/hono/Dockerfile.api`; runner/verifier targets are in `deploy/hono/Dockerfile.runner`. Domain code is shared across Node and Workers. Workers do not hold permanent PostgreSQL listeners; Node composition owns selected listener/consumer lifetimes.

Admission commits jobs and dispatch intent before wake delivery. Consumers claim authoritative PostgreSQL attempts; queue identity cannot grant execution authority. Retries, stale attempts and cancellation use the same fenced commands. Outbox notices contain safe invalidations; subscribers reload authorized snapshots. Transport duplication, loss and reordering are handled by receipt/version/snapshot recovery.

Ports describe required semantics, bounds and cancellation rather than SDK request shapes. Cache decorators may accelerate focused reads later, but cannot replace PostgreSQL authority. Semantic retrieval can extend the existing query boundary without changing publication, authorization or execution codecs; no optional cache/search infrastructure is provisioned now.

Use `make dev` for the fixture-backed local stack. Runtime settings are owned by `apps/api/src/runtime/composition/config.ts`, Node composition, `apps/auth/src/platform-config.ts` and `apps/runner/src/runtime/config.ts`. Credentials are loaded only for selected adapters. Private hosted calls require purpose-scoped application credentials and namespace/attempt proofs; staging currently uses no Cloudflare Access.

Validation includes Node/workerd application tests, disposable PostgreSQL integration, real HTTP/WebSocket protocol fixtures, Docker execution and independent verification. CI requires native SQL, composed runtime, container and workload owners. Provider permissions, hosted isolation and capacity require actual hosted evidence. Production promotion requires explicit authorization under `AGENTS.md`; see [native deployment](../../deploy/README.md).
