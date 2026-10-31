# 01: Drizzle in workerd

Issue #336. Isolated probe, no product changes.

## Results

Local Wrangler/workerd, `nodejs_compat`, local Hyperdrive binding and PostgreSQL 17.11: commit and rollback passed; transaction queries used one backend PID; a competing transaction hit `lock_timeout` with `55P03`, then the row was writable after release. PostgreSQL `bigint` 9223372036854775807 and `numeric` 12345678901234567890.123456789 returned exact strings; bytea `0001ff80` returned exact bytes. Concurrent requests used different backend PIDs. `pg_stat_activity` found no remaining probe clients after success or a thrown handler error. `@cloudflare/vitest-plugin` smoke test ran in workerd.

Pins: Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, pg 8.16.3, Wrangler 4.156.0, workerd 1.20261023.1, Cloudflare Vitest plugin 1.4.11, Vitest 5.0.5, vite-plus 1.4.0. Tested using vp 1.4.0, Node 24.21.0 and Docker PostgreSQL 17.11. The lockfile fixes transitive versions.

## Reproduce

Use only a disposable database: the probe deletes rows in its `runtime_spike` table. From `tools/migration-runtime`:

```sh
vp install -- --ignore-workspace --ignore-scripts
export SPIKE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-runtime-spike -e POSTGRES_PASSWORD="$SPIKE_PASSWORD" -e POSTGRES_DB=spike -p 127.0.0.1:55431:5432 postgres:17
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB="postgresql://postgres:$SPIKE_PASSWORD@127.0.0.1:55431/spike" vp exec wrangler dev --local --ip 127.0.0.1 --port 58731
```

After PostgreSQL and Wrangler are ready, in another shell from the same directory:

```sh
vp run test
vp exec vitest run
```

Both passed. Stop Wrangler and remove the container with `docker rm -f quorem-hono-runtime-spike`. The HTTP probe listens only on loopback; do not expose it or point it at a shared database.

## Foundation implications and limits

Use `drizzle-orm/node-postgres` with invocation-owned clients, explicit `finally` cleanup and transaction-bound collaborators. Preserve bigint/numeric strings and byte buffers; do not cast them to JS numbers. Use transaction-local lock settings. The exact tested pins are a starting point; coordinate upgrades across consumers.

Local Hyperdrive connects directly to PostgreSQL; this does not validate hosted Hyperdrive pooling, cache settings, network failure, capacity, or production lifetimes. This probe does not establish Drizzle schema/migration parity or broad codec coverage. The Vitest smoke verifies workerd APIs only; database assertions use Wrangler HTTP. With this isolated package, `vp test run` failed to find the current suite while `vp exec vitest run` passed; resolve Vite+ runner integration before standardizing that command. Dependency installation reported ignored build scripts; `--ignore-scripts` succeeded here but platform-specific installs still need validation.

`vp check --no-fmt` could not start: the root `vite.config.ts` could not resolve `vite-plus` because this isolated worktree has no root dependencies installed.
