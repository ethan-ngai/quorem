# Code quality sweep

Tracking: [#560](https://github.com/ethan-ngai/quorem/issues/560). Baseline: `67a5051b` (`origin/dev`).

## Coordination

Review first, implementation second. Review all source areas; inventory generated/vendor/fixture areas separately. Findings require source evidence, affected consumers, canonical owner, remedy, risk and verification. Prefer deletion/composition and maintained existing dependencies over new frameworks or wrappers. Preserve behavior, authorization and private data boundaries.

| Reviewer | Coverage | Findings document | State |
| --- | --- | --- | --- |
| Terra frontend | apps/web, apps/marketing, packages/ui, DESIGN.md | frontend.md | Reviewed |
| Terra backend | apps/api, apps/auth, packages/database, packages/contracts | backend.md | Reviewed |
| Terra platform | apps/runner, apps/language, apps/realtime-cloudflare, packages/questions, packages/execution, deploy, infra, scripts, workflows, tools | platform.md | Reviewed |
| Orchestrator | Cross-area synthesis, dependencies, implementation sequencing and validation | README.md | Reviewed |

## Protected pre-existing edits

Do not stage, overwrite or commit existing edits: API interview lifecycle integration, problem repository tests, application list-query and tests; web admin/practice search tests, catalogSearch, TableControls, table.css, useServerTable tests; tables docs; contracts generated envelopes/OpenAPI/package.json/new pagination.ts; scripts/dev.py. Check current git status before implementation: other active chats may add changes.

## Implementation rules

Orchestrator assigns exact worktree/branch/file ownership after synthesis. Independent branches start at origin/dev, dependent branches at predecessor. Feature PRs target dev; merge after checks. No production deployment or main promotion. Update findings with disposition and validation. Record explicitly any unverified hosted/browser/database states.

## Review synthesis and implementation order

All source roots inventoried; reviewers performed risk-focused structural inspection, not line-by-line certification. Reports explicitly record unreviewed areas.

1. Frontend: repair splitter lifecycle, centralize custom-case storage/snapshots, enforce tooltip tokens, then isolate workspace draft lifecycle with race-focused tests.
2. Backend: unify catalog visibility predicates; decompose authoring repository along query/import boundaries while preserving transactions and locks. Improve readiness scan only where correctness remains unchanged; persisted projections require an explicit invalidation model.
3. Platform: canonical type rendering and direct starter composition, then canonical execution transport decoding and projection compatibility.
4. Re-review integrated changes; validate relevant Node/worker/database/browser consumers. Keep package choices evidence-driven: existing Radix/TanStack/AJV/ws remain preferred; no verified replacement yet justifies migration.

Deferred pending evidence/design: relay/probe retirement requires deployed-reference evidence; persisted readiness needs runtime invalidation design; protected pagination changes belong #559. Security-sensitive result stream batching requires bounded window and revocation conformance before acceptance.

## Baseline validation

- Web typecheck passed; 112 test files passed, 1 skipped: 601 tests passed, 2 skipped.
- API boundary check initially fails on pre-existing #559 import `application/list-query.ts -> @quorem/contracts/pagination`; preserve that owner's changes.
- Existing Vite servers on 127.0.0.1:5173 and :5175 both use this checkout (`apps/web` cwd). Browser validation must confirm intended source checkout for the final integrated state.
