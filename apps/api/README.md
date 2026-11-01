# API development

`make dev` starts the integrated native Hono/TypeScript stack with embedded Better Auth, runner, verifier, local queue, fixtures and live Vite/Astro HMR. It uses the dedicated `quorem_hono_dev` database and preserves older local databases.

Individual configured entrypoints are `make api`, `make runner`, `make verifier` and `make language`. The Workers entrypoint is `src/runtime/worker.ts`; the portable Node entrypoint is `src/runtime/node.ts`.

Configure each service before starting it. The API runtime settings are defined in [Node composition](src/runtime/node.ts) and [runtime configuration](src/runtime/composition/config.ts); auth settings are defined in [auth configuration](../auth/src/config.ts) and [platform configuration](../auth/src/platform-config.ts). Runner and verifier settings are defined in [runner configuration](../runner/src/runtime/config.ts); language settings are defined in [the language gateway](../language/src/main.ts). Managed identity uses Better Auth sessions and verified tokens. Local development identity is an explicit Node-only configuration, not the default or a public Worker fallback.

`EXECUTION_WAKE_PROVIDER=sqs|cloudflare-rest` selects the Node delivery adapter. Node consumes published wakes and requires `EXECUTION_DRAIN_URL`, `EXECUTION_DRAIN_SECRET`, and `EXECUTION_DRAIN_ACCESS_MODE=none|cloudflare-access`; Access mode also requires its client ID/secret pair. Only local fixtures may explicitly disable consumption with `EXECUTION_NODE_QUEUE_MODE=disabled`. Workers uses its native queue handler.

Native API startup does not apply migrations. Use a direct privileged migration connection to the same PostgreSQL database used by API/auth; product and auth retain separate schemas and ledgers:

```sh
DATABASE_URL="$QUOREM_OPERATOR_DATABASE_URL" vp exec node packages/database/src/migrate.ts product apps/api/migrations
DATABASE_URL="$QUOREM_OPERATOR_DATABASE_URL" vp exec node packages/database/src/migrate.ts auth apps/auth/migrations
```

Existing name-only migration history requires the [audited checksum baseline](../../docs/plans/hono-workers-migration/execution/38f-migration-checksums.md); do not replace its history or run migration commands with the restricted runtime role.

For a self-contained local browser stack with real fixture accounts and Docker execution, follow [the browser fixture instructions](../../docs/plans/hono-workers-migration/execution/37j-browser-smoke.md). Its reset is destructive and accepts only the dedicated loopback `127.0.0.1:55701/quorem_hono_runtime_test` database. Never point integration tests at the development database; they truncate data.

### Normalize retained result sidecars

After applying product migrations through 060, stop and drain every legacy result writer and judge. Configure `QUOREM_OPERATOR_DATABASE_URL` with the privileged database connection and `AUTH_ORIGIN` with the issuer of the verified bootstrap administrator. Preview a bounded batch, then acknowledge the drain and repeat the same command until `complete` is `true`:

```sh
make backfill-results ARGS='--op-id result-cutover-1 --reason cutover --limit 16 --max-batches 100 --dry-run'
make backfill-results ARGS='--op-id result-cutover-1 --reason cutover --limit 16 --max-batches 100 --legacy-drained'
```

The command normalizes retained legacy result headers and cases before repairing missing public status sidecars. Each source is locked and committed separately; a malformed or conflicting source fails the command. `--limit` is at most 64 and `--max-batches` at most 1000. Exit 2 means more work remains; rerun with the same operation ID and arguments. Dry run rolls writes back and previews one item, not the whole dataset. On interruption, the command reports observed committed counts and marks the current outcome unknown; retry with the same operation ID to reconcile. The drain flag is an operator assertion, not an automatic drain. Keep old writers stopped until activation and verify `complete` before serving normalized readers.
