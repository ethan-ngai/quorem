# Quorem

- Be concise. Use `vp` for TypeScript tooling.
- Monorepo: deployable apps in `apps/`; shared packages in `packages/`.
- Stack: Go API/judge; Astro marketing; React + TanStack Router + Vite+; modern vanilla CSS; PostgreSQL/Aurora Serverless v2; Terraform; GitHub Actions. Better Auth + Cognito live behind an isolated TypeScript auth service.
- Build for <1k users. Keep a credible path to 1M+ through bounded workloads, explicit contracts, and measured scaling. Add infrastructure when justified.
- Keep domain logic provider-neutral. Isolate persistence, realtime, execution, identity, and queue adapters. Allow Redis/ElastiCache without rewriting domain rules.
- Develop locally with fixtures first. Require AWS credentials only for cloud validation/deployment.
- Follow Conventional Commits. Use worktrees, dependency-ordered PR stacks, concise GitHub tickets, and agents with explicit ownership/contracts.
- Provision with Terraform; deploy through GitHub Actions. Keep secrets outside source control.
- Anchor UI to root `DESIGN.md`; use the design-system skill. Prioritize the editor before other pages.
- Editor first: CodeMirror 6, Python Solution/ListNode/TreeNode, completion/hover/signatures/diagnostics, real judging, server autosave/browser recovery. Then invite-based 1v1. Defer FFA, parties, collaboration, points/leaderboard, social, adaptive selection.
- Ask subjective/blocking questions individually through the question tool; keep the turn open while awaiting answers. Use judgment for routine engineering choices; document defaults and evidence gates.
- Planning is not implementation authorization. Keep specs, confirmed requirements, defaults, and release gates distinct.
