# Canonical implementation owners

[Plan index](README.md)

Extract a shared owner after reading existing analogues and all consumers. Share semantics, not merely similarly named helper functions. Consumer-specific policy stays explicit; choose composition and pure functions over inheritance hierarchies.

| Behavior | Canonical owner | Consumers / boundary |
| --- | --- | --- |
| Question validation, signatures, starters, constraints, typed inputs and comparators | `packages/questions` | API authoring, judge, seed/import tools; pure values |
| Runtime/harness revisions, private execution frames and checkpoints | `packages/execution` | API admission and trusted judge; server-only exports |
| Table/column definitions and lossless database mappings | `packages/database` | Product/auth/judge repositories; no browser imports |
| Authentication/session assurance | `modules/identity` plus Better Auth owner | HTTP/WS/CLI adapters call the same authority contract |
| Product capabilities, guest/host/private-library access | `modules/access` | Commands and authorized read models; no provider policy copies |
| Operation identity, fingerprinting and replay | Named command owner using shared operation-record primitive | HTTP and socket retries share semantics; command-specific equality stays explicit |
| Match transitions and deadline evaluation | `modules/matches` pure transition functions | HTTP commands, alarms and reconciliation |
| Interview membership/question epochs and stage policy | `modules/interviews` cohesive command families | HTTP, socket RPC, execution admission |
| Document changes and UTF-16 validation | Interview document owner using question/source codecs | Collaboration, restored drafts, admission source fencing |
| Dispatch claims, retry scheduling and backoff | Durable-work primitives | Distinct execution/notice/deadline processors |
| Read models and DTO projections | Respective domain query owner | HTTP/socket callers reuse authorized snapshots |
| Socket request correlation, bounds and recovery | Protocol engine | Node WS and Cloudflare DO transports |
| Config units/defaults and selected capabilities | Composition schema | HTTP, scheduler and judge shells |

## Refactoring sequence

1. Inventory equivalent behavior and write shared contract/golden cases.
2. Choose one owner with existing consumers. Move semantics there without changing wire behavior.
3. Migrate every consumer; remove old local implementations/defaults in the same integrated slice.
4. Compare outputs and failure semantics. Check imports prevent backsliding.

Published question versions, interview snapshots, execution cases and browser DTOs represent different lifetimes/privacy. Share codecs and deliberate projections; do not collapse them into one mutable universal object. Drizzle rows do not replace these distinctions.

No new generic `common`, `helpers` or `utils` dumping ground. Name primitives by responsibility; extract a package only when multiple process/build consumers need it. Keep extension-only types documented until a current caller justifies executable code.
