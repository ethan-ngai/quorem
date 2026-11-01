# Task dependency schedule

[Plan index](../README.md)

Each row is one small task packet, not an agent permanently assigned to a domain. Prerequisite IDs form the dispatch DAG; all contracts must be merged or explicitly assigned as stacked bases. Three worker slots maximum with the current runtime budget.

| Packet | Prerequisites |
| --- | --- |
| [00 Baseline and inventory](tasks/00-baseline.md) | Authorization |
| [01 Workerd Drizzle spike](tasks/01-drizzle-spike.md) | 00 |
| [02 Auth runtime feasibility](tasks/02-auth-spike.md) | 00 |
| [03 Cross-runtime behavior vectors](tasks/03-vectors.md) | 00 |
| [04 Hono and workspace foundation](tasks/04-foundation.md) | 01, 02, 03 |
| [05 Drizzle schema and migration mapping](tasks/05-schema.md) | 04 |
| [06 Transaction and persistence primitives](tasks/06-db-primitives.md) | 05 |
| [07 Canonical question model and starters](tasks/07-question-model.md) | 04, 03 |
| [08 Exact case codecs and comparisons](tasks/08-question-codecs.md) | 07, 03 |
| [09 Private execution contracts](tasks/09-execution-contracts.md) | 08 |
| [10 Product identity and access policy](tasks/10-identity-access.md) | 06, 07 |
| [11 Better Auth Drizzle persistence](tasks/11-auth-db.md) | 06, 10, 02 |
| [12 Auth media mail and storage adapters](tasks/12-auth-capabilities.md) | 11 |
| [13 Authorized catalog and content queries](tasks/13-catalog.md) | 08, 10 |
| [14 Question drafts and publication](tasks/14-authoring.md) | 13 |
| [15 Durable work claim and wake primitives](tasks/15-dispatch.md) | 06, 09 |
| [16 Deadline and maintenance processing](tasks/16-scheduler.md) | 15 |
| [17 Workspace identity and Odyssey reads](tasks/17-workspace.md) | 13, 10 |
| [18 Submission admission transaction](tasks/18-admission.md) | 17, 15, 09 |
| [19 Submission results and cancellation](tasks/19-results.md) | 18 |
| [20 Match lifecycle and reconciliation](tasks/20-match-core.md) | 18, 16, 13 |
| [21 Match invitations guests and selection](tasks/21-match-invites.md) | 20 |
| [22 Interview membership and lifecycle](tasks/22-interview-core.md) | 14, 10, 15 |
| [23 Interview question and stage controls](tasks/23-interview-question.md) | 22, 08 |
| [24 Interview document commands](tasks/24-document.md) | 23, 03 |
| [25 Interview presence and monitoring](tasks/25-presence.md) | 24 |
| [26 Interview execution admission and feedback](tasks/26-interview-exec.md) | 24, 19, 23 |
| [27 Trusted runner claim and lease lifecycle](tasks/27-runner-leases.md) | 18, 19, 09, 06 |
| [28 Sandbox adapters and framed execution](tasks/28-runner-engine.md) | 27 |
| [29 Checkpoint replay and bounded drains](tasks/29-runner-resume.md) | 28 |
| [30 Shared browser socket protocol](tasks/30-socket-protocol.md) | 21, 25, 26, 19 |
| [31 Node portability socket adapter](tasks/31-node-sockets.md) | 30 |
| [32 Cloudflare browser Durable Objects](tasks/32-do-sockets.md) | 30 |
| [33 TypeScript language gateway consolidation](tasks/33-language.md) | 10, 04 |
| [34 Go-backed CLI and seed replacements](tasks/34-cli.md) | 14, 09, 06 |
| [35 Terraform native backend resources](tasks/35-infra.md) | 16, 29, 32, 12 |
| [36 Deployment and local integration](tasks/36-deploy.md) | 35, 31, 33, 34 |
| [37 Independent security and parity audit](tasks/37-audit.md) | 36 |
| [38 Authorized staging and production cutover](tasks/38-cutover.md) | 37 |
| [39 Go and obsolete path removal](tasks/39-retirement.md) | 38 |

## Gates

- 00-03: baseline and executed runtime/contract evidence; failures change plan before ports.
- 04-09: Hono foundation, Drizzle/schema/transaction primitives and canonical values.
- 10-26: identity, read models and atomic product commands; independent slices can overlap by graph.
- 27-34: bounded TS runner, shared sockets, native/Node adapters and remaining process/tool consumers.
- 35-37: infrastructure preparation, integrated validation and independent review; no production changes.
- 38-39: explicitly authorized release, verified drain/observation, final removal.

Start eligible work across ranges when contracts are ready; numeric order is not a single serial queue. Example: 07 can overlap 05; 15 can overlap catalog work; 33 can run while interview packets progress. Ownership takes precedence over apparent parallelism.

Schema/contract changes produce predecessor patches. No tasks mutate the same paths concurrently. If a packet needs subdivision, preserve its acceptance criteria and update this graph plus the ledger before dispatch.

Pure question codecs (08) depend on canonical values and exact oracles, not database transactions (06). Persistence uses those pure codecs through backend mappings; this removes an unnecessary dependency without changing acceptance.
