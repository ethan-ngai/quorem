# Reusable primitives and atomic commands

[Plan index](README.md)

Implement only primitives exercised by migration consumers. Each has one owner, focused contract and conformance tests; no universal CRUD/service framework.

| Primitive | Required semantics | Explicit limit |
| --- | --- | --- |
| Transaction scope | Drizzle transaction-bound repositories, deadlines, classified constraint failures | No ORM types crossing domain ports |
| Operation record | Principal/scope/key, canonical request fingerprint, persisted response, conflict on mismatched reuse | No blanket retry of mutations |
| Versioned transition | Current state + command + sampled database time -> decision and notice intent | No duplicated transition authority in DO/queue handlers |
| Authorized snapshot | Caller/scope -> consistent projection and aggregate version | No general raw-table API |
| Projection mapper | Public, owner and interviewer-private DTO construction | Never generic ORM row serialization |
| Dispatch claim | Expiring fenced claim, bounded batch, publish-before-ack, durable continuation | Separate work contracts remain distinct |
| Bounded work lane | Concurrency, queue/byte bounds, cancellation, backpressure | Not a global Worker process scheduler |
| Stream decoder | Incremental framed input, byte/frame caps, terminal validation | Never buffer full checkpoint suites |
| Page cursor | Stable keyset tuple, validated scope/filter identity | No unstable relevance/offset masquerading as stable cursor |
| Safe telemetry | Request/operation correlation, query/lease/queue duration and error categories | No source, fixtures, credentials or raw provider errors |

## Atomic command pattern

Decode and validate once -> resolve principal -> acquire transaction -> authorize against locked/current state -> check operation replay -> apply a pure decision -> persist state/accounting/outbox/response -> commit -> request durable dispatch. A replay returns the recorded result; changing source/epoch after the original commit does not invalidate that replay.

Commands with required execution prewake retain the existing precommit guarantee and commit-race recovery; see [durable work](background.md). Do not force every command through identical ordering when existing replay semantics require a different check.

Expose a focused atomic repository operation or consumer-owned transaction scope whose collaborators are already transaction-bound. Drizzle `db`/`tx` types stay inside persistence/composition; do not make a giant generic UnitOfWork containing every domain repository. A decision callback may invoke pure rules but must not perform network side effects.

Implement small commands such as `admitSubmission`, `applyDocumentUpdate`, `setInterviewQuestion`, `advanceInterviewStage`, `finalizeMatch`. Their persistence methods encode the atomic operation rather than exposing arbitrary `save()` chains. Transaction callbacks call no email/sandbox/provider network side effects. Avoid holding locks while sending socket snapshots.

## Read path

Separate commands from query interfaces without adding a second data store. Fetch compact authorized projections, batch related reads and reuse HTTP/socket snapshot builders. Bound query count and connection holding time; preserve consistent snapshots where needed. This creates actual decorator points for future caches and candidate retrieval without introducing either feature now.

No UI components are redesigned. Reusable components here mean application policies, query objects, codecs, protocol handlers and adapters; editor logic remains outside migration scope.
