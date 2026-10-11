# Quorem planning

Status: review-ready planning baseline. Confirmed requirements are binding; engineering defaults use delegated judgment. Evidence gates are assigned to implementation tickets. No product implementation or cloud provisioning yet.

## Confirmed

- First milestone: solo editor, real judging, persistence, mocked match state.
- First execution language: Python.
- CodeMirror 6 with Python IntelliSense in milestone one (scope below).
- LeetCode-style Python `class Solution` methods with typed starter signatures.
- Include ListNode and TreeNode in the initial harness and editor declarations.
- Python intelligence runs in a separate local backend service: completion, hover, signatures, syntax/type diagnostics. Navigation/refactoring/formatting deferred.
- System theme + override; blue accent; Geist Sans/JetBrains Mono; resizable problem-left/editor-right/results-below layout; desktop-first narrow-screen fallback.
- Drafts: server autosave/browser recovery; latest server save wins with history. Run examples/custom input; Submit safe verdict/counts/error summaries. One active-or-queued job per user; reject additional work.
- Development-only identities first. Real 1v1 starts with private invites, not public matchmaking.
- MVP subsequently includes real 1v1 with a LeetCode-style workspace.
- Go; Astro marketing; React + TanStack Router; Vite+; modern vanilla CSS; Terraform; GitHub Actions. Better Auth + Cognito through a small TypeScript auth service; public email/password and social sign-in.
- Local development first; six original seeded problems. AWS us-east-1: Lambda API, Aurora Serverless v2, AppSync Events. $100/month cost gate; pgvector deferred until intelligent selection.
- Initial workload validation: 20 matches/40 coding sessions; 2 execution requests/sec burst. This is a measured capacity target, not a guarantee of sustained use within budget.
- Visual references: Linear, Notion, Vercel; local personal-website and CUXR repositories.
- Eventual: FFA, parties, collaborative editing, points, leaderboard, social, adaptive selection. These require extension seams, not MVP implementations.

## Documents

| Spec | Scope |
| --- | --- |
| [Architecture](architecture.md) | Boundaries, contracts, storage, scaling |
| [Contracts](contracts.md) | Wire schemas, HTTP errors, events, codec rules |
| [Editor](editor.md) | First milestone, UI states, drafts, accessibility |
| [Python intelligence](intelligence.md) | Language service, sessions, type declarations, capability checks |
| [Judge](judge.md) | Python execution, fixtures, verdicts, isolation |
| [Multiplayer](multiplayer.md) | 1v1 lifecycle, authority, realtime |
| [Identity](auth.md) | Better Auth/Cognito, sessions, Go verification |
| [Operating defaults](operating-defaults.md) | Resource/latency limits, retention, admission |
| [Delivery](delivery.md) | Local environment, AWS evaluation, CI/deployment |
| [Work plan](work-plan.md) | Dependencies, tickets, agent ownership, acceptance |
| [Decisions](decisions.md) | Interview ledger and remaining questions |

Implement dependency-ordered tickets after this planning phase. Freeze schemas/EditorView seam before parallel domain work. Capability/security/cost spikes settle empirical choices without requiring more routine preference questions. Marketing follows the working editor and local 1v1.
