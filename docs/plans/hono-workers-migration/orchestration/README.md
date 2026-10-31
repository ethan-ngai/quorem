# Swarm orchestration guide

[Plan index](../README.md)

All execution subagents: `gpt-6.1-terra`, reasoning `medium`. One orchestrator; at most three concurrent workers/reviewers with the current four-slot budget. The active user goal authorizes implementation and orchestration on `feat/hono-migration`; production/main promotion remains separately gated.

## Read and dispatch

1. [Ownership](ownership.md): exclusive paths, contracts, integration duties.
2. [Dependency schedule](schedule.md): 40 small packets; prerequisite graph is authoritative.
3. [Task template](task-template.md): fill exact branch/base/paths/tests before dispatch.
4. [Integration](integration.md): review, merge, recovery and acceptance.

Orchestrator first reads scope, architecture, Drizzle, canonical owners, primitives and validation. Each agent reads its packet, listed guides, assigned analogues and actual consumers. Do not send every agent the whole plan as a substitute for scope.

Start packets only after their prerequisites are merged or available as an explicitly assigned stacked base. At most one owner per path; dependencies do not permit simultaneous editing of shared files. A packet is a dispatch unit, not permission to run every task in its wave.

## Deliverables

Every packet produces a completed vertical slice or an executed spike report. Return conventional commit(s), affected contracts/consumers, meaningful tests with actual results, remaining limitations and deletion notes. Review failures become narrow follow-up packets. No stub success, duplicate policy implementation or deferred validation hidden behind a green PR.

Milestones: runtime proof -> Drizzle/schema/primitives -> canonical semantics -> product commands -> judge/socket parity -> deployment gates -> authorized cutover -> Go retirement. New KV/search functionality remains outside every packet.
