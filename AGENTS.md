# Quorem

- Be concise. Use `vp` for TypeScript tooling.
- Monorepo: deployable apps in `apps/`; shared packages in `packages/`.
- Stack: Go API/judge; Astro marketing; React + TanStack Router + Vite+; modern vanilla CSS; PostgreSQL/Aurora Serverless v2; Terraform; GitHub Actions. Better Auth + Cognito live behind an isolated TypeScript auth service.
- Build for <1k users. Keep a credible path to 1M+ through bounded workloads, explicit contracts, and measured scaling. Add infrastructure when justified.
- Keep domain logic provider-neutral. Isolate persistence, realtime, execution, identity, and queue adapters. Allow Redis/ElastiCache without rewriting domain rules.
- Develop locally with fixtures first. Require AWS credentials only for cloud validation/deployment.
- Use Conventional Commits for commits and branch names. Branch format: `<type>/<scope>-<description>` in lowercase kebab-case (e.g. `feat/editor-custom-cases`, `fix/editor-completion`, `docs/quorem-planning`). Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore. No agent/tool prefixes. Use worktrees, dependency-ordered PR stacks, concise GitHub tickets, and agents with explicit ownership/contracts.
- Provision with Terraform; deploy through GitHub Actions. Keep secrets outside source control.
- Anchor UI to root `DESIGN.md`; use the design-system skill. Prioritize the editor before other pages.
- Editor first: CodeMirror 6, Python Solution/ListNode/TreeNode, completion/hover/signatures/diagnostics, real judging, browser-only drafts/history. Then invite-based 1v1. Defer FFA, parties, collaboration, points/leaderboard, social, adaptive selection.
- Ask subjective/blocking questions individually through the question tool; keep the turn open while awaiting answers. Use judgment for routine engineering choices; document defaults and evidence gates.
- Planning is not implementation authorization. Keep specs, confirmed requirements, defaults, and release gates distinct.

## Task workflow

- Start each task by reading this file, inspecting Git status/worktrees and open GitHub issues/PRs, and checking relevant `docs/plans/` and `docs/implementation/` guidance. GitHub is the current work ledger; do not depend on previous chat history.
- Link work to an existing GitHub issue or create a concise issue for new substantive work. Reuse a suitable worktree for ongoing work; create an isolated worktree from current `origin/main` for independent work. Preserve unrelated changes.
- Push a conventional branch and open/update a draft PR linked to its issue, with concise behavior and validation evidence. For dependent work, base each PR on its predecessor and record the order; otherwise target `main`.
- Keep PR descriptions short and Markdown-organized: brief `Changes` and `Validation` sections with bullets. Add `Dependencies` or `Limitations` only when needed. Describe the final change; avoid dense prose, chat history and exhaustive implementation inventories.
- Fix failing CI before marking ready. Merge only when the user authorizes it, in dependency order; update remaining PR bases and local `main` afterward. Keep workflow instructions on `main` so new chats inherit them.
- PostgreSQL integration tests truncate data. Point `QUOREM_TEST_DATABASE_URL` only at a separate disposable test database, never the running development database.
