# Quorem

- Be concise. Use `vp` for TypeScript tooling.
- Monorepo: deployable apps in `apps/`; shared packages in `packages/`.
- Stack: Go API/judge; Astro marketing; React + TanStack Router + Vite+; modern vanilla CSS; PostgreSQL/Aurora Serverless v2; Terraform; GitHub Actions. Better Auth + Cognito live behind an isolated TypeScript auth service.
- Build for <1k users. Keep a credible path to 1M+ through bounded workloads, explicit contracts, and measured scaling. Add infrastructure when justified.
- Keep domain logic provider-neutral. Isolate persistence, realtime, execution, identity, and queue adapters. Allow Redis/ElastiCache without rewriting domain rules.
- Develop locally with fixtures first. Require AWS credentials only for cloud validation/deployment.
- Always use a live Vite dev server for local UI iteration; never hand-build or serve `dist`/preview after each edit. React: `vp -C apps/web dev`; marketing: `vp -C apps/marketing run dev` (Astro uses Vite/HMR). Use `make dev` for the integrated local stack. Builds are for production/CI validation, not the editing loop. Confirm the server runs from the intended worktree and give its exact URL; assign distinct ports to concurrent worktrees.
- Use Conventional Commits for commits and branch names. Branch format: `<type>/<scope>-<description>` in lowercase kebab-case (e.g. `feat/editor-custom-cases`, `fix/editor-completion`, `docs/quorem-planning`). Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore. No agent/tool prefixes. Use branches, dependency-ordered PR stacks, concise GitHub tickets, and agents with explicit ownership/contracts.
- Provision with Terraform; deploy through GitHub Actions. Keep secrets outside source control.
- Anchor UI to root `DESIGN.md`; use the design-system skill. Prioritize the editor before other pages.
- Editor first: CodeMirror 6, Python Solution/ListNode/TreeNode, completion/hover/signatures/diagnostics, real judging, browser-only drafts/history. Then invite-based Showdown and Free-for-all. Defer parties, collaboration, points/leaderboard, social, adaptive selection.
- Ask subjective/blocking questions individually through the question tool; keep the turn open while awaiting answers. Use judgment for routine engineering choices; document defaults and evidence gates.
- Planning is not implementation authorization. Keep specs, confirmed requirements, defaults, and release gates distinct.

## Task workflow

- Start each task by reading this file, inspecting Git status/worktrees and open GitHub issues/PRs, and checking relevant `docs/plans/` and `docs/implementation/` guidance. GitHub is the current work ledger; do not depend on previous chat history.
- Link work to an existing GitHub issue or create a concise issue for new substantive work. Normally check out a conventional branch in the existing checkout; use worktrees only under the concurrent-agent rules below. Preserve unrelated changes.
- Push a conventional branch and open/update a draft PR linked to its issue, with concise behavior and validation evidence. For dependent work, base each PR on its predecessor and record the order; otherwise target `main`.
- Keep PR descriptions short and Markdown-organized: brief `Changes` and `Validation` sections with bullets. Add `Dependencies` or `Limitations` only when needed. Describe the final change; avoid dense prose, chat history and exhaustive implementation inventories.
- Fix failing CI before marking ready. Merge only when the user authorizes it, in dependency order; update remaining PR bases and local `main` afterward. Keep workflow instructions on `main` so new chats inherit them.
- PostgreSQL integration tests truncate data. Point `QUOREM_TEST_DATABASE_URL` only at a separate disposable test database, never the running development database.

## Worktrees and collaboration

- Use worktrees only while multiple agents actively work on features concurrently. Otherwise, check out a branch in the existing checkout; do not create a worktree for a solo task.
- Only the orchestrating superagent may create worktrees. Subagents use their assigned checkout and must never create their own worktrees. The orchestrator inspects existing worktrees and reuses suitable ones before creating more.
- For concurrent feature work, assign a worktree and conventional branch per independent feature. Base independent work on fresh `origin/main`; dependent work starts from its predecessor's committed branch and records the PR order.
- Give each agent an exact checkout path, branch, file ownership and integration contract. Separate concurrent independent or overlapping edits with orchestrator-managed worktrees. Sharing a checkout is allowed only with disjoint file ownership; the orchestrator owns commits and integration.
- Worktrees share Git history, not working files or uncommitted edits. Commit small handoff milestones. Dependent agents consume commits by branching from or merging the producer's branch; do not copy files between checkouts or assume another agent's edits are present.
- Integrate committed branches in dependency order on a coordinator's integration branch. Resolve conflicts there, inspect the combined diff and run relevant checks. Use merges to retain branch history; cherry-pick only selected, explicitly identified commits. Avoid integrating the same change by both methods.
- Push/update draft PRs; merge into `main` only with user authorization. After merging, refresh remaining PR bases and local `main`. The orchestrator archives worktrees after their changes are integrated and no user work depends on them; preserve needed ignored files first.
- Manual edits belong in the task's checkout, normally the existing checkout on its task branch. For concurrent work, name and link the assigned worktree to the user. Reserve the user's files or pause agents editing them. Preserve uncommitted user changes; never reset, reformat, stage or commit them without authorization. The user may contribute to the same branch/PR. Their running dev server must point at that checkout.
