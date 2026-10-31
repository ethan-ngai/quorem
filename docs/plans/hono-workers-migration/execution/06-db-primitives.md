# 06: PostgreSQL connection and transaction primitives

Issue #351. `@quorem/database/core` exports `createNodePool`, `withNodeConnection`, `withWorkerConnection`, `ConnectionScope`, `Transaction`, `DatabaseFailure` and `classifyDatabaseError`. Node callers own and close the bounded pool; Worker callers pass the invocation's Hyperdrive connection string and receive a fresh client. Both scopes require a finite lifetime and accept an AbortSignal. Call `scope.transaction({ statementTimeoutMs, lockTimeoutMs }, async tx => ...)`; only transaction-bound Drizzle query operations are exposed. Optional isolation and read-only settings are applied at BEGIN. One transaction at a time per scope. Callbacks must not retain a scope or issue detached work. Never retry a mutation callback automatically.

Abort destroys the client, including borrowed pooled clients; waiters that acquire after cancellation are destroyed. Transaction-local PostgreSQL deadlines apply to all callback SQL. A missing commit acknowledgment reports `unknown_commit`; a definite PostgreSQL commit error preserves its underlying classification. Resolve an unknown outcome with the original operation key. SQLSTATE 57014 is `query_cancelled` (not necessarily a timeout). Classification unwraps Drizzle causes. Existing bytea and passkey counter codecs remain unchanged.

## Reproduce

The tests create/delete/drop dedicated probe tables; use only the isolated database. From repository root, with Docker and installed workspace dependencies:

```sh
export SPIKE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-primitives-06 -e POSTGRES_PASSWORD="$SPIKE_PASSWORD" -e POSTGRES_DB=quorem_hono_primitives_test -p 127.0.0.1:55436:5432 postgres:17
export QUOREM_TEST_DATABASE_URL="postgresql://postgres:$SPIKE_PASSWORD@127.0.0.1:55436/quorem_hono_primitives_test"
vp -C packages/database run test:integration
```

After PostgreSQL is ready, start local workerd in another shell:

```sh
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB="$QUOREM_TEST_DATABASE_URL" vp -C apps/api exec wrangler dev --local --config ../../packages/database/wrangler.test.jsonc --ip 127.0.0.1 --port 58736
```

Once ready, `vp -C packages/database run test:workers`. Stop Wrangler, then `docker rm -f quorem-hono-primitives-06`. Run these fixtures serially; neither is for shared environments.

## Results and limits

PostgreSQL 17.11, pg 8.16.3, Drizzle 0.45.4, Wrangler 4.156.0/workerd 1.20261023.1: eight Node tests passed for commit/rollback, same PID, wrapped/deferred constraints, lock/statement deadlines, abort, lifetime, pool exhaustion and late waiter cleanup, plus terminated backend during commit without replay. Actual workerd HTTP fixture passed success, rollback, statement timeout, exception and abort; PostgreSQL activity checks confirmed Worker connection release. `vp -C packages/database run typecheck` and `vp check --no-fmt` passed.

The local binding connects directly to PostgreSQL; hosted Hyperdrive transaction pooling, capacity, cache configuration and network behavior remain unverified. The terminated-backend test verifies conservative ambiguous-commit reporting, not whether a commit actually reached PostgreSQL. Aborting a scope closes SQL connections; arbitrary non-database work in a callback cannot be forcibly cancelled. Deadline settings cannot protect network I/O outside the scope. Schema migration and codec parity belong to packet 05.
