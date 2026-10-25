# Quorem

- Be extremely concise; sacrifice grammar for concision.
- Use `vp` for TypeScript tooling.
- Anchor UI to root `DESIGN.md`; use the design-system skill. Prioritize the editor.
- Develop locally with fixtures; require provider credentials only for cloud validation/deployment.
- UI iteration uses live Vite/HMR, never rebuild/preview loops. Web: `vp -C apps/web dev`; marketing: `vp -C apps/marketing run dev`; integrated stack: `make dev`. Verify the server's checkout and report its exact URL.
- Ask subjective/blocking questions individually through the question tool; keep the turn open awaiting answers. Decide routine engineering details autonomously.
- Planning alone does not authorize implementation.
- Provision with Terraform; deploy through GitHub Actions.
- Architecture and provider rules: [architecture](docs/plans/architecture.md), [adapters](docs/implementation/platform-adapters.md). Read before backend/infrastructure work.

## Implementation

- Before implementing, inspect analogous code and its consumers; identify the shared owner.
- Implement common behavior/styles in that owner using shared primitives, composition and inheritance (DRY, single responsibility). Keep consumer-specific differences explicit.
- Before finishing, review the diff for duplicated logic/defaults and obsolete paths; remove them and verify affected consumers.

## Git workflow

- GitHub issues/PRs are the work ledger. Inspect them and Git status/worktrees at task start; link substantive work to an issue.
- `dev` is the integration branch. Solo work, regardless of size, commits and pushes directly to `dev` in the existing checkout; no feature branch or PR.
- Within one conversation, do not commit unfinished work awaiting human input. During active back-and-forth edits, commits are allowed; squash previous related commits from that conversation.
- Separate feature branches/PRs are required only when multiple agents work concurrently under an orchestrating superagent. Target `dev`; merge promptly after relevant checks pass, without asking for additional approval. Delete merged feature branches once no unmerged dependent work needs them.
- For concurrent work with dependencies, prefer stacked PRs: base each on its predecessor, record the order, merge bottom-up, and retarget remaining PRs to `dev` as dependencies land. Keep predecessor branches until dependents are retargeted.
- Keep PR descriptions short: `Changes`, `Validation`; add `Dependencies` or `Limitations` only when needed. Draft only while unfinished.
- Merging `dev` into `main` requires explicit user authorization. Keep this workflow in `dev`; future tasks start from fresh `origin/dev`.
- Conventional commits and feature branches: `<type>/<scope>-<description>`, lowercase kebab-case; no agent/tool prefixes.
- Worktrees only for actively concurrent feature agents; solo work uses the existing checkout. Only the orchestrator creates/assigns/integrates/removes worktrees. Assign exact checkout, branch, file ownership and contracts; independent work starts from `origin/dev`, dependent work from its predecessor's commits.
- Preserve uncommitted user changes; never stage/commit them without authorization. Their dev server must use their checkout.
- PostgreSQL integration tests truncate data: `QUOREM_TEST_DATABASE_URL` must target a separate disposable database, never the running development database.
