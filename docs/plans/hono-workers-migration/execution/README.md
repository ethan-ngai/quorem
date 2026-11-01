# Migration execution ledger

Umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335). Active implementation authorized; production/main promotion remains separately gated.

## Current checkpoint — 2026-10-31

The functional Hono/Drizzle port is integrated on `feat/hono-migration`. [#460](https://github.com/ethan-ngai/quorem/pull/460) retired all 296 compiled Go sources and module files, switched local development/Make/CI to native TypeScript, and removed the obsolete Go release workflow. Production/main traffic is unchanged.

- Full native CI [41254328875](https://github.com/ethan-ngai/quorem/actions/runs/41254328875) passed both jobs on deployment source `f51658d7`. Native API image build/import, SQL practice/match, HTTP/WebSocket/runner/verifier workload, Node language gateway and CLI suites passed.
- Actual isolated `make dev` topology completed seeded login → workspace → Python Run → automatic local queue/runner/Docker/verifier → accepted result. Default development data and the user's `scripts/dev.py` host edit were preserved.
- Hosted stage [41252212186](https://github.com/ethan-ngai/quorem/actions/runs/41252212186) passed preflight/full validation, bootstrap, image publication and migrations; failed runtime-role commit before API/private-service provisioning.
- [#462](https://github.com/ethan-ngai/quorem/pull/462) corrected Neon’s documented requirement for plaintext role passwords over TLS with server-side SCRAM. Hosted probe [41254166995](https://github.com/ethan-ngai/quorem/actions/runs/41254166995) confirmed actual role creation and login. Its initial cleanup was unconfirmed; [#463](https://github.com/ethan-ngai/quorem/pull/463) accounts explicitly for Neon’s reserved provider superuser. Hosted cleanup [41254329268](https://github.com/ethan-ngai/quorem/actions/runs/41254329268) confirmed disabled login and zero remaining sessions. Full activation retry [41254374611](https://github.com/ethan-ngai/quorem/actions/runs/41254374611) on `f51658d7` passed all validation, image publication, migrations and role creation/login; Cloudflare then denied Hyperdrive creation (permission code `10000`). API Terraform may contain partially created resources; inspect its state before retrying. Hosted acceptance has not run. The existing deployment token needs account-level Hyperdrive Edit/Write, or an explicitly selected alternative database transport. No new Neon key or Access token is needed.
- Staging reuses the existing Neon project and an independent schema-only branch/database. Cloudflare Access is omitted; application credentials and signed execution proofs remain.

Remaining completion work: finish isolated Workers/Hyperdrive/Queues/private-service activation and hosted acceptance/workload checks. Resolve functional provider failures as encountered. Further recovery-history/resume hardening, retained production-data cutover and production promotion are deferred; no KV or semantic-search feature is implemented. Earlier sections below record evidence at their implementation checkpoints, not current release state.

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
| 12c | Integrated | [#391](https://github.com/ethan-ngai/quorem/pull/391); PostgreSQL profile admission; 18 focused tests after rebase; uncertain execution retains capacity |
| 12d | Integrated | [#396](https://github.com/ethan-ngai/quorem/pull/396); isolated Sharp/R2 and explicit child-exit proof; supervisor loss withholds proof and retains capacity; hosted recovery remains |
| 14 | Integrated | [#385](https://github.com/ethan-ngai/quorem/pull/385), `1393ab99`; Worker-safe generated validators and atomic question publication |
| 15 | Integrated | [#384](https://github.com/ethan-ngai/quorem/pull/384); durable dispatch intents and wake adapters; deployment ingress replacement remains |
| 16 | Integrated | [#392](https://github.com/ethan-ngai/quorem/pull/392), `184ee74f`; 7 PostgreSQL and 3 real workerd/DO tests after rebase; transition binding and hosted delays remain |
| 17 | Integrated | [#394](https://github.com/ethan-ngai/quorem/pull/394); scoped workspaces/Odyssey; 5 Node/PG and 2 workerd/PG tests after rebase; CI fixture wired |
| 18 | Integrated | [#397](https://github.com/ethan-ngai/quorem/pull/397); admission, recovery and cancellation; includes actual Go judge differential execution; current shared-owner merges under validation |
| 19a/19b | Integrated | [#400](https://github.com/ethan-ngai/quorem/pull/400); bounded result/header streaming, current authorization per page, privileged legacy normalization; 23 PG and 6 workerd tests; final staging cleanup and lint passed |
| 20a | Local committed | Canonical pure/transactional reconciliation; full lifecycle belongs 20b |
| 20b | Local committed | `123a66a2`, [#389](https://github.com/ethan-ngai/quorem/issues/389); lifecycle; 12 PG and 2 workerd tests; host revocation tightening continues in 21 |
| 21 | Local committed | `d35593ab`, [#398](https://github.com/ethan-ngai/quorem/issues/398); invitations/join/removal/current-match and shared selection; 9 PG and 1 workerd tests |
| 22/23a | Local committed | Interview membership/lifecycle and safe normalized snapshots; migration 051; runtime mounting remains |
| 23b | Local committed | `2de377a8`, [#387](https://github.com/ethan-ngai/quorem/issues/387); question controls/manual advancement and privileged 051 backfill |
| 24 | Local committed | `ab4deefe`, [#390](https://github.com/ethan-ngai/quorem/issues/390); official ChangeSet/document commands; realtime must pass original push text for fingerprint replay |
| 25 | Local committed | `33d0f43d`, [#393](https://github.com/ethan-ngai/quorem/issues/393); cross-instance presence/monitoring; real workerd heartbeat during held document lock and paste/focus privacy |
| 26 | Local committed | `16194ed8`, [#395](https://github.com/ethan-ngai/quorem/issues/395); fenced interview admission, actual promotion/manual-stage race and streamed privacy; production mounting remains |
| 27 | Local committed | Fenced private runner commands, bounded manifests, signed independent verifier evidence, checkpoint v2 and normalized promotion; real Docker/private HTTP pipeline exercised in 29 |
| 28 | Local committed | [#388](https://github.com/ethan-ngai/quorem/issues/388); five actual Docker languages, durable daemon/state-directory fencing and signed namespace-bound remote proof; hosted remote isolation remains unverified |
| 33 | Integrated | [#401](https://github.com/ethan-ngai/quorem/pull/401); trusted Node language gateway, actual Docker lifecycle and acknowledged close before replacement |
| 34 | Integrated | [#406](https://github.com/ethan-ngai/quorem/pull/406); canonical operator/fixture tools, self-contained Go/TS publication interoperability fixture |
| 29a | Local committed | `518a8146` stack, [#402](https://github.com/ethan-ngai/quorem/issues/402); resumable orchestration, independent Node verifier, immediate checkpoint verification and real Docker/private HTTP signed promotion; 17 admission/runner regressions |
| 29b | Local committed | `83aba9a1`, [#405](https://github.com/ethan-ngai/quorem/issues/405); sealed indexed admission, no full fixture transfer; actual >128 MiB stored fixture admitted through workerd |
| 29c | Local committed | `ea0cfde0`, [#407](https://github.com/ethan-ngai/quorem/issues/407); bounded interview input producers, immutable guards and audited legacy normalization; actual large-fixture workerd flow |
| 29d | Superseded | Interim unavailable-only reconciliation replaced by verified progress reader in 29f; not a final implementation |
| 29e | Local committed | `5b989105`, [#409](https://github.com/ethan-ngai/quorem/issues/409); SQL manifest binding, constant-state ordered digest; fresh authoring remains 320 cases; separate 408-case historical fixture |
| 29f | Local committed | `419b1547`, [#411](https://github.com/ethan-ngai/quorem/issues/411); real verified match scoring, deadline/cancellation races, Odyssey feedback preservation and native workerd regressions |
| 29g | Local committed | `518a8146`; migrations 059/060 stream public/private status feedback; audited dry-run/backfill refuses missing or ambiguous legacy source; results PG 26/26, workerd private status 1/1 |
| 30a/30b/30c | Local committed | `9377130d` stack, [#399](https://github.com/ethan-ngai/quorem/issues/399); bounded socket notices/document pages and shared browser receipt credit; authorized HTTP snapshot/status streams |
| 31 | Local committed | `14a9e506`, [#403](https://github.com/ethan-ngai/quorem/issues/403); real Node WebSocket/PG replicas, live authorization and shared protocol |
| 32 | Local committed | `cc1a9191`, [#404](https://github.com/ethan-ngai/quorem/issues/404); actual workerd DO/PG opaque grants, quotas, revocation and receipt pressure; mandatory local managed hibernation passed in 35a; hosted behavior remains unverified |
| 35a | Integrated | [#415](https://github.com/ethan-ngai/quorem/pull/415); composed Node/Worker runtime, per-aggregate DO routing, mandatory managed hibernation, trusted peer attribution, scheduled repair and two-instance fanout proved locally |
| 35b | Integrated | Staged Terraform/native artifacts; current private ingress uses application bearers and signed proofs, without Access; see current checkpoint |
| 36a | Local committed | `9c374b72`, [#413](https://github.com/ethan-ngai/quorem/issues/413); executable verifier and fenced HTTP/continuous runner; actual spawned-process Docker promotion and SIGTERM teardown |
| 36b | Local committed | `04d57ea1`, [#417](https://github.com/ethan-ngai/quorem/issues/417); real staged runner/verifier containers, trusted host daemon, signed promotion, competing startup, held-fence refusal and SIGTERM teardown; local topology only |
| 37a | Local committed | `6e07b5a9`, [#414](https://github.com/ethan-ngai/quorem/issues/414); canonical lifecycle fixtures and real verified late completion; Node 14/14 and workerd 2/2 |
| 37b | Local committed | `452be536`, [#416](https://github.com/ethan-ngai/quorem/issues/416); self-contained mandatory release validation; named disposable database, both ledgers, canonical catalog, missing-prerequisite and skip refusal, CI wiring |
| 37c/37d | In review | [#419](https://github.com/ethan-ngai/quorem/issues/419); independent guest creation, scheduled retention, normalized terminal input cleanup and protected shared blobs; migration 061 bounds orphan scans/deletes with an atomic cursor; backlog cleanup is eventual |
| 37e | Local committed | `e87c6438`, [#420](https://github.com/ethan-ngai/quorem/issues/420); profile settings independent of media; real Node/workerd PostgreSQL proof |
| 37f | Local committed | [#421](https://github.com/ethan-ngai/quorem/issues/421); `f138d499`; native admission fixture uses canonical sealed publication inputs |
| 35c–35f / 36c–36d | Review / integration | Hyperdrive, private services, remote runner, profile media and executable staged workflow; no hosted invocation |
| 37i–37m | Local verification | Ephemeral stage actor; real browser fixture; match presence and interview Run fixes; see reports |
| Hosted 36 / final 37 / 38–39 | Pending | Hosted gates, full audit, browser smoke, cutover and verified Go retirement; no production parity or deployment claim |


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
- Composed runtime/domain mounts and socket protocols passed local end-to-end checks. Staged Terraform/GitHub Actions remain under review; hosted isolation/capacity, recoverable updates, cutover and verified Go retirement remain outstanding. No deployment or dev/main promotion occurred.

Socket integration decision: WebSockets carry bounded invalidations and document pages; large authorized results/snapshots use HTTP streams. All browser consumers, mutation/list responses and shared snapshot readers must move together. An interface pretending Workers can stream a single WebSocket message is insufficient. Old runtime remains active until this refactor and actual Node/DO shells pass end-to-end checks.

## Current integration checkpoint

`feat/hono-migration` at `d327e4c1` includes [#415](https://github.com/ethan-ngai/quorem/pull/415), merged after exact-head CI [41226036650](https://github.com/ethan-ngai/quorem/actions/runs/41226036650) passed. Packets 20–37 listed above as local/review are now integrated through that PR; their individual reports record evidence at implementation time. Recovery controls are integrated through #437; full maintenance/resume remains open in #432. Root owns integration; dev/main remain untouched.

The current review tree includes private image hosting, Vite cache isolation, match presence repair and public interview Run promotion. API typecheck, private service contracts 6/6 and actual Sharp image processing 1/1 passed after integration. CI run `41223310928` passed exact head `d873a24c`; subsequent recovery/data changes still require exact-head CI.

Real Vite browser smoke proved practice Run 3/3 and Submit 20/20, a two-account match win 20/20, and UTF-16 shared interview editing. After the canonical promotion fix, real interview Run 3/3 and Submit 20/20 terminate successfully. Odyssey/manual advancement and the presence fix also passed in the real browser; the fixture then restarted and shut down cleanly. The fixture uses only a separate disposable database and local Docker services; no hosted parity claim follows.

Production gates include provisioned provider isolation/teardown equivalence, database/Worker budgets, workload measurements, old-writer drain, audited backfills, object-source migration, rollback and complete entrypoint/consumer audit. Staged recovery/update is tracked in [#432](https://github.com/ethan-ngai/quorem/issues/432). Terraform's pinned provider persists sensitive service bindings and the Hyperdrive password in state: encrypted, access-restricted state/history is a prerequisite. No cloud apply/deploy, dev/main promotion or Go retirement occurred.

## Combined local release validation

Root independently ran the combined 415 review tree after 36b, 37b, 37c/37d and profile capability integration on fresh loopback PostgreSQL `55690/quorem_hono_runtime_test`. `vp -C apps/api exec node src/runtime/composition/run-validation.mjs` passed fixture bootstrap 1/1, Node 14/14 and native workerd 3/3 with zero skipped tests; the disposable container was removed. This includes actual Node and Wrangler admission → Docker → independent signed HTTP verifier → authorized result, mandatory managed socket eviction/rehydration, peer sanitization, recovery and route inventory. Merged result-stream regressions independently passed 26/26 on the root's separate named disposable database. These results establish local behavior only.

Standalone fixtures use canonical sealed publication inputs. Hosted application ingress denial, provider isolation, persistent-volume failure, real workload/query budgets, browser smoke, migration drain/backfill and rollback remain release gates. No production deployment, dev/main promotion or Go retirement occurred.

## Recovery and data cutover checkpoint

[#432](https://github.com/ethan-ngai/quorem/issues/432) remains incomplete. The recovery primitives are [stage-only DB role fencing](38a-stage-role-fence.md), persistent RunnerService pause, migration 062 immutable claim-attempt inventory, and [namespace-bound case deletion](38c-case-delete-fence.md). These do not yet form an authorized recovery workflow. Historical inventory coverage is unknown; runtime role ownership/grants are now provisioned and checked locally; fresh namespace coverage, ordered teardown, resume and hosted Hyperdrive behavior must still be proved before enabling recovery. A successful drain is not a durable pause.

[#436](https://github.com/ethan-ngai/quorem/issues/436) provides [bounded profile-object audit/copy](38b-profile-object-cutover.md): canonical key parsing, per-page operator audit, conditional destination writes, hash/reread verification and private resume state. Real canonical PostgreSQL migrations and local S3 protocol tests passed. It never deletes source objects or changes profile pointers; its result remains `cutoverReady: false`. The actual source bucket and object inventory remain unverified.

The shared [stage contract validator](../../../../scripts/hono-stage-validation.mjs) starts and removes only its own disposable PostgreSQL container; it ran 58/58 contracts without skips before the inventory addition. Normal PR CI now includes staged orchestration, private service images/contracts and both Terraform modules. Exact-head CI for the latest combined tree is still required; the earlier run is not evidence for subsequent commits.

The combined stage validator subsequently passed 62 contracts without skips, including an actual non-owner Better Auth → JWT → Hono admission → Drizzle claim → protected inventory path. Provisioning checks separate SHA-bound runtime credentials, uses server-side SCRAM storage (client-side prehashing was removed in #462 for Neon compatibility), denies ledger/inventory/DDL/ownership privileges and precedes Hyperdrive application. Local schema/privilege evidence does not establish managed-provider permissions. Full affected Go PostgreSQL adapter/worker suites and six HTTP/socket regressions passed after replacing legacy unscoped test claims; production Go already uses engine-derived scopes. Migration 062 still requires older unscoped writers to drain.

## Resumed completion scope

Finish the existing port; freeze new abstractions. Recovery validation now requires real workerd controls, migration provenance, checksummed ledgers and avatar-copy fixtures without skipped tests. Signed proof capture uses one bounded read; oversized responses cannot strand a cloned stream.

Queue-only deployment protection, Node delivery and SQL execution coverage are integrated. The protected staging environment exists and deployment retries use existing repository credentials. Actual hosted deployment evidence remains required. Existing-stage maintenance is integrated; complete history proof/resume orchestration, production backfill/rollback and Go retirement remain open under #432. No optional cache/search implementation is in scope.

## Node delivery completion

The Node composition now consumes its selected SQS or Cloudflare pull queue through the shared wake/drain owner. It publishes required continuations before acknowledgment; uncertain delivery/acknowledgment retries retain PostgreSQL authority. Production Node startup requires explicit drain configuration instead of silently publishing unconsumed wakes. Local fixtures can explicitly disable the consumer; the real composition test exercises local SQS publication, authenticated drain, delayed early-wake continuation and deletion. Native Workers continues using its existing push handler.
