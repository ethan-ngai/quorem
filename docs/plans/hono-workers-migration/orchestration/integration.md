# Integration and review workflow

[Plan index](../README.md)

## Before dispatch

Verify current sources and ledger. Reconcile expired-attempt reclamation PR #322. Capture complete route/WS/internal/CLI and schema/writer/flag inventories. Assign distinct disposable databases/schemas and ports; do not run truncating tests on development data.

Prepare exact contract commits, path ownership, command selectors and expected outputs. Workerd/Drizzle/Better Auth compatibility must be demonstrated before domain migration starts. Unsupported capabilities fail the spike rather than accumulating partial ports.

## Merge each completed packet

1. Check scope, API/privacy projections, dependency direction and canonical ownership.
2. Compare old/new behavior using reviewed fixtures. Reject duplicated serializers, policies, flags/defaults, read models or competing migration history.
3. Inspect Drizzle query projections, parameter binding, exact types, transaction-client use, lock order and outbox writes. Review plans/query counts for hot paths.
4. Run packet-specific tests and affected consumers; use actual workerd and PostgreSQL where semantics require them. Verify no cache/search implementation slipped in.
5. Merge completed PR into its correct integration/stack base. Retarget dependents as predecessors land; never merge an unfinished child merely to unblock another.
6. Record evidence and any remaining hosted gate in the issue. Run cross-domain scenarios at milestone boundaries; repeat broad suites only when changes/failures justify them.

PR descriptions: `Changes`, `Validation`; dependencies/limitations only when needed. Keep one feature's commits coherent; squash related solo documentation commits from this conversation if they exist. Never stage user changes.

## Scheduling examples

After 00: 01 runtime/Drizzle, 02 auth-runtime and 03 vectors can occupy three slots. After foundation/schema/primitives stabilize, schedule identity, canonical question work and durable work with nonoverlapping paths. Catalog/authoring share package/query contracts; match/interview subpackets must honor their serial prerequisites. Runtime shell edits and schema exports stay serialized through their owner.

Use actual graph in [schedule](schedule.md). Keep a slot available for an independent reviewer near integration milestones; never ask a worker to approve its own security/concurrency changes.

## Final acceptance

All inventory entries assigned and verified; Drizzle schema/migration parity; native Worker API/auth/DO sockets; Node portability; TS judge/language behavior; lossless/hash/session preservation; durable recovery; hosted isolation; cutover/rollback rehearsal; removed Go references. See [validation](../validation.md), [rollout](../rollout.md) and [completion](../completion.md).

Keep implementation and production authorization separate. Preparing workflows/resources is not permission to provision or promote main. No permanent compatibility proxy, speculative cache or vector service.
