# File and contract ownership

[Plan index](../README.md)

Only the orchestrator creates, assigns, integrates and removes worktrees. Proposed convention: `/Users/engai/.codex/worktrees/hono-<packet>/quorem`, branch `feat/hono-<packet>`. Use actual absolute checkout, exact base SHA and allowed file list in each dispatch. Existing unrelated worktrees/user changes are preserved.

## Shared files

Orchestrator owns root/package manifests, lockfile, build/lint/test configuration, final route mounts, package export maps, public schemas/generated clients, migration files/journal, schema aggregate exports, workflows and deployment entrypoints. Delegate one shared-file change exclusively if needed; pause conflicting work first.

Schema/primitives owner initially writes `packages/database`; later domain agents can own their assigned repository subdirectories, never shared schema/core changes implicitly. Auth and product schemas have separate semantic owners, but one coordinated integration gate. A new column/index/constraint request becomes a predecessor schema patch before dependent code merges.

Canonical question and execution package subdirectories are assigned independently only after their interfaces freeze. The orchestrator integrates public exports. No agent copies missing codecs/policies into its own directory to avoid waiting.

## Domain ownership

A domain packet owns its application command/query family, route submodule, persistence implementation subdirectory and tests. Its public interface is consumer-owned and frozen in the dispatch. Adjacent packets can propose a shared operation; the orchestrator selects one owner before edits.

Cross-domain atomic commands receive transaction-bound collaborator ports at composition. No agent imports another module's tables or repository internals. Runners may import shared schema/codecs through backend-only entrypoints; browsers cannot.

## Contract freeze

Record API/DTO, question value, exact codec/hash, transaction operation, projection, event/dispatch, socket protocol and execution revision contracts by commit. Freeze the minimum needed per packet; do not create a giant upfront interface framework. A breaking change needs a small predecessor patch and all consumer assignments.

## Branch policy

Refresh GitHub issues/PRs, status and worktrees before execution. The user explicitly overrides the normal dev integration workflow for this migration. Independent agents start fresh `origin/feat/hono-migration`; dependents use an assigned predecessor commit and stacked PR base. Merge bottom-up, retarget descendants, then delete unused branches/worktrees. No main promotion without explicit authorization.

Solo documentation work uses the existing checkout. Do not create agent worktrees merely to edit this plan. Preserve `scripts/dev.py`; no staging unrelated changes.
