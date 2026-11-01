# Drizzle and PostgreSQL

[Plan index](README.md)

Use **Drizzle ORM over `pg`** for product, auth and judge persistence. Workers use request/invocation-scoped clients through cache-disabled Hyperdrive; Node uses bounded pools. Share typed schema and transaction primitives in backend-only `packages/database`; consumer repositories retain operation-specific SQL/query ownership. [Official Hyperdrive recipe](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/).

## Schema ownership

- `packages/database/src/schema/product/`: existing normalized product tables, references, unique/partial indexes, checks and column mappings.
- `packages/database/src/schema/auth/`: separately qualified Better Auth/plugin tables; preserve current namespace, mixed-case columns and provider fields. Auth remains the semantic owner.
- `packages/database/src/core/`: connection factories, transaction types, database error classification and lossless column codecs. No domain repositories here.
- Schema definitions are canonical for ORM structure. Committed SQL migrations remain canonical for deployed DDL, triggers and procedures. CI verifies agreement; schema generation never silently owns unsupported PostgreSQL objects.
- Infer select/insert types from Drizzle within persistence only. Domain values, command DTOs and public contracts stay explicit; private fields cannot escape via generic row serialization.

## Query and transaction rules

Use Drizzle builders for selects/inserts/updates, explicit projections, predicates and composition. Lock-heavy claims, ordered CTEs, advisory locks and database-clock arithmetic may use parameterized Drizzle `sql` inside the same transaction. Never interpolate user input into `sql.raw`. `sql<T>` declares a compile-time type; it does not decode an untrusted runtime value. [SQL API](https://orm.drizzle.team/docs/sql).

Each application command owns one transaction. Pass the transaction-bound repository/collaborator to all writes and authorization-sensitive reads; never use an outer global `db` from inside the callback. Preserve isolation, row-lock order, `SKIP LOCKED`, statement/lock deadlines, uniqueness and outbox atomicity. Drizzle nested savepoints do not create cross-service atomicity. [Transaction API](https://orm.drizzle.team/docs/transactions).

Keep `bigint`/numeric precision, timestamp units and bytea/checkpoint codecs explicit. Use custom column codecs only where needed, with round-trip vectors; do not globally convert all numeric values to JS numbers. Test all adapters against the same PostgreSQL fixtures. [Custom types](https://orm.drizzle.team/docs/custom-types).

Hyperdrive transaction pooling cannot replace `LISTEN`, session advisory locks or other connection-session state. Use schema-qualified auth queries, transaction-scoped settings and bounded connection lifetimes. No driver socket/client shared across Worker requests. [Pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).

## Migration adoption

1. Reproduce the current schema from existing SQL migrations in a disposable database. Inspect actual catalog state, including triggers, policies, indexes, grants and extensions; introspection is a starting point, not a trusted rewrite.
2. Map that schema into Drizzle without renaming/recreating data. Verify the mapping against both a fresh DB and a restored production-shaped DB. ORM adoption alone requires no initial CREATE TABLE migration.
3. Preserve existing migration filenames, ordering/prefix checks, ledger and advisory lock. Port the current runner to a Node CLI; retain SQL history. Do not replay old DDL into an existing database or invent a second Drizzle journal.
4. Use pinned Drizzle Kit to author/review future diffs and custom SQL; normalize approved SQL into the existing migration sequence, which remains the sole apply ledger. Do not use `drizzle-kit migrate` as a second production runner. Check generated snapshots against a database rebuilt from that same sequence. [Custom SQL generation](https://orm.drizzle.team/docs/kit-custom-migrations).
5. Run migration once through GitHub Actions using a direct operator connection before rollout. No `drizzle-kit push` against shared environments; no migration/seed from Worker cold starts. Keep auth/product histories separate as today.

## Performance and safety

Measure query counts/plans before and after hot reads and commands. Use explicit joined/projection queries and keyset pagination; avoid N+1 relation loading or giant eager graphs. Keep I/O outside transactions unless atomicity requires it; release connections before sandbox execution/socket sending. Persistent Node pools and Hyperdrive origin pools have a shared capacity budget.

Unknown commits retry by original operation key. Do not automatically retry arbitrary mutation callbacks. Disable Hyperdrive query caching for authority-sensitive product/auth reads initially. [Caching semantics](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

Acceptance: schema parity; old/new reader coexistence; rollback/contended transactions; exact lossless columns; auth adapter mapping; parameter binding; no private-row serialization; measured connection lifetime; zero destructive schema changes introduced solely for ORM adoption.
