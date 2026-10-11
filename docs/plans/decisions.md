# Decision ledger

| ID | Decision | Status |
| --- | --- | --- |
| D01 | First milestone: solo editor + real judging + persistence; mock match state | Confirmed |
| D02 | First judge language: Python | Confirmed |
| D03 | CodeMirror 6; Python IntelliSense in milestone one (scope D07) | Confirmed |
| D04 | Python `class Solution` methods with typed starter signatures | Confirmed |
| D05 | Include ListNode and TreeNode in milestone one | Confirmed |
| D06 | Separate local backend language service behind an adapter; cloud hosting later | Confirmed |
| D07 | Require type-aware completion, hover, signatures, syntax/type diagnostics; defer navigation, refactoring, formatting | Confirmed |
| D08 | System theme + manual override; both themes designed | Confirmed |
| D09 | Problem left, editor right, results below editor; resizable panes | Confirmed |
| D10 | Desktop first; usable narrow-screen fallback | Confirmed |
| D11 | Restrained blue accent; semantic verdict colors | Confirmed |
| D12 | Geist Sans UI + JetBrains Mono code | Confirmed |
| D13 | Server autosave + browser recovery copy | Confirmed |
| D14 | Most recent server save wins; retain recovery history | Confirmed |
| D15 | Run public examples + custom inputs; Submit hidden cases | Confirmed |
| D16 | Submit reveals verdict, passed/total, safe error summary | Confirmed |
| D17 | One nonterminal execution per user; reject new execution while busy | Confirmed |
| D18 | Development-only identities first; production auth before public release | Confirmed |
| D19 | Private invite links first; public matchmaking deferred | Confirmed |
| D20 | Earliest server-received correct submission wins; wait for earlier eligible jobs | Confirmed |
| D21 | Host selects 15/30/45/60-minute deadline; default 30; fixed at readiness/start | Confirmed |
| D22 | Deadline: most hidden tests passed wins; equal score draws | Confirmed |
| D23 | Disconnect: clock continues, reconnect until deadline; explicit forfeit only | Confirmed |
| D24 | Opponent visibility: connection/readiness, submission status, best passed-test count; source private | Confirmed |
| D25 | Match selection: random within host difficulty filter, revealed at start | Confirmed |
| D26 | Finalization: up to two minutes; no contest if unresolved judging could alter outcome | Confirmed |
| D27 | Explicit forfeit is immediate concession; pending jobs cannot reverse completed outcome | Confirmed |
| D28 | Run cancellable; match Submit irrevocable | Confirmed |
| D29 | Six original seeds: two easy, two medium, two hard; array/string/list/tree coverage | Confirmed |
| D30 | Python standard library; no third-party packages | Confirmed |
| D31 | AWS AppSync Events; native local WebSocket adapter | Confirmed |
| D32 | Initial public operating target: $100/month | Confirmed |
| D33 | Load target: 20 simultaneous matches/40 coding sessions; 2 execution requests/sec burst | Confirmed |
| D34 | Aurora Serverless v2 target, subject to budget validation | Confirmed |
| D35 | Initial AWS region us-east-1; configurable Terraform | Confirmed |
| D36 | Public email/password plus social sign-in; Better Auth + Cognito | Confirmed |
| D37 | Use engineering judgment instead of asking routine technical questions | Confirmed |

## Engineering defaults

User delegated routine technical choices. Defaults below are implementation requirements unless evidence demands an ADR update; they are not additional user answers.

- Go modular application, root Go module; pgx/database SQL adapters, explicit migrations; OpenAPI + versioned event schemas.
- Local durable PostgreSQL job queue; cloud SQS queue adapter. Transactional outbox for durable updates; realtime remains nondurable fanout with snapshots.
- Python language-service capability spike chooses maintained server against the four required features; pin the supported runtime and stubs together.
- Browser IndexedDB recovery; autosave after 750ms idle; latest server-accepted revision wins. Retain at most 100 accepted revisions for 30 days, plus bounded local recovery. Offline code is preserved for explicit restore/save rather than automatically replacing remote code on reconnect.
- Solo and match drafts have separate namespaces; match starts from a clean starter template. Solo submissions cancellable; admitted match submissions cannot be cancelled. One user cannot participate in multiple active matches.
- Match admission uses locked aggregate sequence and database time, eligible only before deadline. Equal timestamps ordered by sequence; no-submission score zero; best score is maximum over eligible submissions. Explicit forfeit takes precedence while outcome is uncommitted.
- Local containers only for trusted development. Public runner target: isolated Linux sandbox with gVisor on a dedicated EC2 worker host, bounded per-job/per-case resources and no sandbox network/secrets. Host/controller separation and isolation checks are release gates; microVM adapter remains an upgrade seam.
- Cognito owns passwords/verification/reset; Better Auth owns application sessions and JWT issuance. Start social federation with Google through Cognito. GitHub can use Better Auth's direct adapter later; no new OIDC bridge solely for GitHub. Account linking is explicit and verified, never based only on equal email strings.
- Single origin routes for workspace/API/auth; separate static marketing deployment. Short-lived access JWTs in memory; secure HTTP-only session cookies; no persistent browser token storage.
- Seed fixtures managed in Git; no admin CMS in MVP. Fixed score-suite version, fresh Solution/input per case, trusted comparator outside sandbox.
- Numeric limits, latency targets, retention, and deployment gates: [operating defaults](operating-defaults.md). Security, auth and cost gates need evidence before public release; local work proceeds without cloud credentials.

## Evidence gates, not interview blockers

Validate language-server capabilities, sandbox isolation, cloud cost, database connection behavior, and real adapter parity during their assigned tickets. Update the ADR if evidence invalidates a default. Product scope changes require the user's input; routine fixes within the confirmed scope do not.
