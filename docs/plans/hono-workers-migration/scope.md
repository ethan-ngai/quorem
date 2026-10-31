# Scope and baseline

[Plan index](README.md)

Status: implementation authorized by the active end-to-end orchestration goal. Production/main promotion remains separately authorized. Target subagents: `gpt-6.1-terra`, reasoning `medium`; one orchestrator, bounded parallel ownership.

Replace Go product services with idiomatic TypeScript/Hono. Cloudflare Workers is the primary HTTP runtime. PostgreSQL remains authoritative. Cloudflare SDKs/bindings remain in adapters and runtime shells. Prove portability through a working Node deployment shell using the same application modules.

Completion includes retiring Go API, judge orchestration, language gateway, tooling and CI dependencies. Untrusted language runtimes, Python harnesses and PostgreSQL case containers remain isolated processes. The trusted judge supervisor and optional hosted language engines may still need Node containers; migrating language does not make those workloads suitable for Workers isolates.

## Baseline and ledger

Inspected checkout: `/Users/engai/CS/Projects/quorem`, local `dev`, commit `57fd5db`, October 30, 2026. `scripts/dev.py` has an existing user modification; preserve it. No migration code changed during planning.

- Product API: 116 production Go files, approximately 15,065 lines; 120 Go test files. Runner: 9 production Go files, 22 test files. Shared `internal/`: 10 production files. Language gateway adds another Go component.
- OpenAPI currently describes 53 paths / 59 operations. Actual route registrations also include health, session and WebSockets; auth and internal execution protocols have separate contracts. Generate a complete inventory before estimating completion.
- Current shells: `apps/api/cmd/api`, `apps/auth/src/server.ts`, `apps/api/worker`, `apps/runner/cmd/runner`, `apps/language/cmd/language`, `deploy/worker.js`, `deploy/router.js`, `deploy/case-sandbox.js`.
- Current product persistence: `apps/api/internal/adapters/postgres`; SQL migrations in `apps/api/migrations`. Preserve existing migration history and data. Better Auth retains its separate schema/history.
- `docs/implementation/platform-adapters.md` currently explicitly retains Go/Node processes. This proposal supersedes that compute decision only after implementation is authorized and the replacement passes validation.
- Migration integration branch: `feat/hono-migration`, per explicit user correction. Local/remote `dev` restored to pre-migration `57fd5db`. Do not merge migration work into dev or main without a new user instruction. Production workflows remain main-only.
- Existing worktrees are unrelated unless their owner confirms otherwise. Do not reuse or remove them based on this plan.

Related ledger: [provider boundaries #76](https://github.com/ethan-ngai/quorem/issues/76), [hosted validation #206](https://github.com/ethan-ngai/quorem/issues/206), [question reconciliation #294](https://github.com/ethan-ngai/quorem/issues/294), [execution budgets #303](https://github.com/ethan-ngai/quorem/issues/303), [lossless cases #314](https://github.com/ethan-ngai/quorem/issues/314), [sandbox teardown #317](https://github.com/ethan-ngai/quorem/issues/317), [runtime configuration drain #266](https://github.com/ethan-ngai/quorem/issues/266). Open [PR #322](https://github.com/ethan-ngai/quorem/pull/322) changes expired-attempt reclamation; reconcile its final state before freezing execution contracts. None of these links proves a production migration is safe.

Migration umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335). Create child issues as packets become ready, following the [task schedule](orchestration/schedule.md). Record dependencies, contract commits, PRs and evidence there. Refresh baseline from current owning sources first.
