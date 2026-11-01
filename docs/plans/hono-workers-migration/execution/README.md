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
| 01 | Integrated | [#340](https://github.com/ethan-ngai/quorem/pull/340); actual workerd/PG probes; hosted Hyperdrive remains unverified |
| 02 | Integrated | [#341](https://github.com/ethan-ngai/quorem/pull/341); real auth runtime probes; full WebAuthn/social/image/mail gates remain |
| 03 | Integrated | [#344](https://github.com/ethan-ngai/quorem/pull/344); deterministic public/private Go vectors and owner-package hashes/frames |
| 04 | Integrated | [#345](https://github.com/ethan-ngai/quorem/pull/345), integration commit `344ca41`; Node/workerd/type/boundary tests and CI passed |
| 05 | Review | [#350](https://github.com/ethan-ngai/quorem/pull/350); local PG catalog, repeat/upgrade/restore fixtures and counter checks passed |
| 06 | Review | [#351](https://github.com/ethan-ngai/quorem/issues/351); connection/transaction primitives; owned-client disconnect audit underway |
| 07 | Review | [#348](https://github.com/ethan-ngai/quorem/pull/348); model/metadata/starters, Node smoke; full publication belongs to 08 |
| 08 | Review | [#349](https://github.com/ethan-ngai/quorem/issues/349); lossless codecs, publication, Node/workerd Go differential vectors; not activated |
| 10a | Running | [#353](https://github.com/ethan-ngai/quorem/issues/353); managed identity/access slice; guest lifecycle follows separately |
| 12a | Review | [#352](https://github.com/ethan-ngai/quorem/issues/352); portable image port and explicit sharp adapter; hosted capability remains separate |
| Other packets | Pending | Follow prerequisite graph and empirical gates; no broad backend parity claim |


Reports update here or link their issue/PR; no claimed runtime parity without executed tests. Agent worktrees start from committed baseline `d2c86b5` on dedicated `origin/feat/hono-migration`. All migration PRs target `feat/hono-migration` or a predecessor feature branch; CI follows that integration target; production workflows remain main-only.

## Branch correction

Migration commits and child PRs moved off dev at the user's request. `feat/hono-migration` is the sole integration target; dev/main merges require a new instruction. Existing agent commits remain isolated on their feature branches.

## Validation and scheduling

- [#347](https://github.com/ethan-ngai/quorem/pull/347) adds native API Node/workerd/type/import checks to CI and integration-push checks. Existing Go/auth/browser checks remain until verified retirement.
- Pure question codecs depend on model/oracles, not database runtime. Packet 08 scheduling reflects that dependency direction.
- Image-port extraction (12a) is a bounded precursor independent of the later auth factory. It does not satisfy Worker image processing or hosted mail.
- Local root review reran schema restore/catalog tests against a separate loopback database on port 55435; development database untouched. Node/workerd API tests passed on the integration-shaped tree.
