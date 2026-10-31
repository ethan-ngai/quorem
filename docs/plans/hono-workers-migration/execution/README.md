# Migration execution ledger

Umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335). Active implementation authorized; production/main promotion remains separately gated.

## Baseline 00

- Checkout `dev` at `57fd5db`; fetched `origin/main` at `2be21ba`. Exact tracked trees match (`git diff --exit-code dev origin/main`); main is ahead only by release merge commits. User correction: migration belongs on `feat/hono-migration`; local/remote `dev` restored to `57fd5db`. The migration documentation commit `d2c86b5` is preserved on the dedicated branch.
- Preserve user modification in `scripts/dev.py`. Plan documentation belongs to this conversation and can be committed separately.
- PR #322 is still open, head `27b09e27ea034dc5853ab5edb2a5e80c3197bbf5`. Do not alter another task's PR/worktree. Freeze its exact attempt/sandbox-scope teardown contract as mandatory input to packet 27; initial Go baseline lacked migration 048. [Reclaim prerequisite](27-reclaim-baseline.md) adopts the frozen guard and regression oracle on the migration branch; TypeScript runner port remains packet 27.
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
| 05 | Integrated | [#350](https://github.com/ethan-ngai/quorem/pull/350); PG catalog, repeat/upgrade/restore fixtures and counter checks passed |
| 06 | Integrated | [#355](https://github.com/ethan-ngai/quorem/pull/355); bounded connection/transaction primitives and borrowed-client disconnect tests; socket-close fix integrated in [#365](https://github.com/ethan-ngai/quorem/pull/365) |
| 07 | Integrated | [#348](https://github.com/ethan-ngai/quorem/pull/348); model/metadata/starters, direct Node smoke |
| 08 | Integrated | [#357](https://github.com/ethan-ngai/quorem/pull/357); lossless codecs, publication, Node/workerd Go differential vectors; not activated |
| 09 | Integrated | [#362](https://github.com/ethan-ngai/quorem/pull/362); private execution contracts and bounded codecs; Node/workerd tests passed |
| 10a | Integrated | [#358](https://github.com/ethan-ngai/quorem/pull/358); managed identity/access slice; guest lifecycle and actual route composition remain |
| 11 | Integrated | [#369](https://github.com/ethan-ngai/quorem/pull/369); scoped native auth, signed passkeys and real fixture mail; product runtime mounting remains |
| 12a | Integrated | [#354](https://github.com/ethan-ngai/quorem/pull/354); portable image port and explicit sharp adapter; Worker upload processor/budget and hosted capability remain |
| 12b | Integrated | [#369](https://github.com/ethan-ngai/quorem/pull/369); encrypted durable mail, fenced compensation and lock-expiry tests |
| 13 | Integrated | [#367](https://github.com/ethan-ngai/quorem/pull/367); restricted-role PostgreSQL/workerd catalog queries and cursor contracts |
| 10b | Integrated | [#382](https://github.com/ethan-ngai/quorem/pull/382); scoped guests and shared request budgets |
| 12c | CI review | [#391](https://github.com/ethan-ngai/quorem/pull/391); PostgreSQL profile admission; 18 focused tests after rebase; uncertain execution retains capacity |
| 12d | Local committed | Isolated Sharp service, supervised children, native workerd/R2/PG and crash fixtures; hosted termination/recovery remain gates |
| 14 | Integrated | [#385](https://github.com/ethan-ngai/quorem/pull/385), `1393ab99`; Worker-safe generated validators and atomic question publication |
| 15 | Integrated | [#384](https://github.com/ethan-ngai/quorem/pull/384); durable dispatch intents and wake adapters; deployment ingress replacement remains |
| 16 | CI review | [#392](https://github.com/ethan-ngai/quorem/pull/392); 7 PostgreSQL and 3 real workerd/DO tests after rebase; transition binding and hosted delays remain |
| 17 | Local committed | Scoped workspaces/Odyssey; 5 Node/PG and 2 workerd/PG tests after rebase; CI fixture wired |
| 18 | Integration review | Admission, recovery and cancellation; includes actual Go judge differential execution; current shared-owner merges under validation |
| 19a/19b | Local committed | Bounded result/header streaming, current authorization per page, privileged legacy normalization; 23 PG and 6 workerd tests; final staging cleanup and lint passed |
| 20a | Local committed | Canonical pure/transactional reconciliation; full lifecycle belongs 20b |
| 20b | Running | [#389](https://github.com/ethan-ngai/quorem/issues/389); create/settings/ready/start/leave/forfeit |
| 22/23a | Local committed | Interview membership/lifecycle and safe normalized snapshots; migration 051; runtime mounting remains |
| 23b | Local committed | `2de377a8`, [#387](https://github.com/ethan-ngai/quorem/issues/387); question controls/manual advancement and privileged 051 backfill |
| 24 | Local committed | `ab4deefe`, [#390](https://github.com/ethan-ngai/quorem/issues/390); official ChangeSet/document commands; realtime must pass original push text for fingerprint replay |
| 25 | Running | [#393](https://github.com/ethan-ngai/quorem/issues/393); cross-instance presence and private monitoring |
| 27 | Local committed | Fenced private runner commands, typed execution source, chunked checkpoint/completion, immutable receipts and normalized promotion; actual engine provenance being integrated in 28 |
| 28 | Running | [#388](https://github.com/ethan-ngai/quorem/issues/388); actual five-language Docker engines and signed namespace-bound remote proof; fault/replay review underway |
| 33/34 | Local committed | Trusted Node language gateway and canonical operator/fixture tools; deployment/CI/retirement integration remains |
| 21/26/29–32/35–39 | Pending | Follow prerequisite graph and empirical gates; no broad backend parity, hosted validation or Go-retirement claim |


Reports update here or link their issue/PR; no claimed runtime parity without executed tests. Independent agent worktrees start from current `origin/feat/hono-migration`; dependent packets use their assigned predecessor commit. Preserve branches until all dependent work is integrated. All migration PRs target `feat/hono-migration` or a predecessor feature branch; CI follows that integration target; production workflows remain main-only.

## Branch correction

Migration commits and child PRs moved off dev at the user's request. `feat/hono-migration` is the sole integration target; dev/main merges require a new instruction. Existing agent commits remain isolated on their feature branches.

## Validation and scheduling

- [#347](https://github.com/ethan-ngai/quorem/pull/347) adds native API Node/workerd/type/import checks to CI and integration-push checks. Existing Go/auth/browser checks remain until verified retirement.
- Pure question codecs depend on model/oracles, not database runtime. Packet 08 scheduling reflects that dependency direction.
- Image-port extraction (12a) is a bounded precursor independent of the later auth factory. It does not satisfy Worker image processing or hosted mail.
- Local root review reran schema restore/catalog tests against a separate loopback database on port 55435; development database untouched. Node/workerd API tests passed on the integration-shaped tree.

## Integration constraints

- Prepared/committed packets are not integrated or activated. Root owns manifests, lockfile, schema coordination, production composition and exact-head checks. Maintain the packet dependency order when merging the accumulated local branches.
- 051/052 normalization and byte-page streaming replace whole-private-payload projection. Operator backfills require drained old writers, current authority, source locks/hash checks and explicit refusal to overwrite authoritative normalized results.
- Final runner integration must exercise admission → trusted TS orchestration → actual isolated engine → checkpoint/retry → authorized result stream, including failure/teardown and lost ACK. Individual packet tests do not establish this path.
- Runtime shells, real domain mounts, socket protocols, Terraform/GitHub Actions deployment, hosted isolation/capacity, cutover and verified Go retirement remain outstanding. No deployment or dev/main promotion occurred.
