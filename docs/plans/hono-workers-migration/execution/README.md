# Migration execution ledger

Umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335). Active implementation authorized; production/main promotion remains separately gated.

## Baseline 00

- Checkout `dev` at `57fd5db`; fetched `origin/main` at `2be21ba`. Exact tracked trees match (`git diff --exit-code dev origin/main`); main is ahead only by release merge commits. Restore remote `dev` from this existing integration line without merging or rewriting main.
- Preserve user modification in `scripts/dev.py`. Plan documentation belongs to this conversation and can be committed separately.
- PR #322 is still open, head `27b09e27ea034dc5853ab5edb2a5e80c3197bbf5`. Do not alter another task's PR/worktree. Freeze its exact attempt/sandbox-scope teardown contract as mandatory input to packet 27; current Go baseline lacks migration 048. TS migration must preserve the stronger fence and supply additive schema guards before activation.
- Docker server, PostgreSQL CLI, Go 1.27.3 and Vite+ available. Existing local PostgreSQL container serves development data; all migration tests receive separately named disposable databases/schemas.
- [Source inventory](inventory.json): 66 HTTP operations, delegated auth/internal/socket commands, background work, 208 schema declarations, configuration names, SQL writer sources and six Go CLIs. Every entrypoint has a packet owner. Inventory includes source pointers; each packet must review dynamic/delegated behavior before replacing it.

## Dispatch state

| Packet | State | Evidence |
| --- | --- | --- |
| 00 | Complete for dispatch | Exact baseline-tree comparison and source inventory; reclaim contract frozen above |
| 01 | Ready | workerd + Drizzle runtime probe |
| 02 | Ready | pinned auth runtime feasibility probe |
| 03 | Ready | cross-runtime exact-value vectors |
| 04-39 | Pending | Follow prerequisite graph and runtime evidence |

Reports update here or link their issue/PR; no claimed runtime parity without executed tests. Update exact base SHA after the plan/inventory commit before creating agent worktrees.
