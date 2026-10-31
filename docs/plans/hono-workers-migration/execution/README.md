# Migration execution ledger

Umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335). Active implementation authorized; production/main promotion remains separately gated.

## Baseline 00

- Checkout `dev` at `57fd5db`; fetched `origin/main` at `2be21ba`. Exact tracked trees match (`git diff --exit-code dev origin/main`); main is ahead only by release merge commits. User correction: migration belongs on `feat/hono-migration`; local/remote `dev` restored to `57fd5db`. The migration documentation commit `d2c86b5` is preserved on the dedicated branch.
- Preserve user modification in `scripts/dev.py`. Plan documentation belongs to this conversation and can be committed separately.
- PR #322 is still open, head `27b09e27ea034dc5853ab5edb2a5e80c3197bbf5`. Do not alter another task's PR/worktree. Freeze its exact attempt/sandbox-scope teardown contract as mandatory input to packet 27; current Go baseline lacks migration 048. TS migration must preserve the stronger fence and supply additive schema guards before activation.
- Docker server, PostgreSQL CLI, Go 1.27.3 and Vite+ available. Existing local PostgreSQL container serves development data; all migration tests receive separately named disposable databases/schemas.
- [Source inventory](inventory.json): 66 HTTP operations, delegated auth/internal/socket commands, background work, 208 schema declarations, configuration names, SQL writer sources and six Go CLIs. Every entrypoint has a packet owner. Inventory includes source pointers; each packet must review dynamic/delegated behavior before replacing it.

## Dispatch state

| Packet | State | Evidence |
| --- | --- | --- |
| 00 | Complete for dispatch | Exact baseline-tree comparison and source inventory; reclaim contract frozen above |
| 01 | Running | [#336](https://github.com/ethan-ngai/quorem/issues/336), Terra medium; isolated workerd + Drizzle probe |
| 02 | Running | [#337](https://github.com/ethan-ngai/quorem/issues/337), Terra medium; auth runtime probe |
| 03 | Running | [#338](https://github.com/ethan-ngai/quorem/issues/338), Terra medium; exact-value vectors |
| 04-39 | Pending | Follow prerequisite graph and runtime evidence |

Reports update here or link their issue/PR; no claimed runtime parity without executed tests. Agent worktrees start from committed baseline `d2c86b5` on dedicated `origin/feat/hono-migration`. All migration PRs target `feat/hono-migration` or a predecessor feature branch; CI follows that integration target; production workflows remain main-only.

## Branch correction

Migration commits and child PRs moved off dev at the user's request. `feat/hono-migration` is the sole integration target; dev/main merges require a new instruction. Existing agent commits remain isolated on their feature branches.
