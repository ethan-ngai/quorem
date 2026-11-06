# Social design audit

Issue #626, PR #629. Audited against root `DESIGN.md`.

| Owner | Deviation | Fix / design principle |
| --- | --- | --- |
| `apps/web/src/features/social/PlayerDirectory.tsx:74` | Raw IDs and an unnecessary ID column | One identity column: name and canonical @username; model user concepts, disclose useful metadata. |
| `apps/web/src/features/social/SocialPage.tsx:162` | Raw UUID beneath profile heading | Shared participant identity renders username; internal IDs remain routing keys only. |
| `apps/web/src/features/social/SocialPage.tsx:94` | Featured nemesis repeated in the table | Feature first rival once; table lists remaining rivals. Each section adds information. |
| `apps/web/src/ui/Table.tsx:15` | Directory rows too spacious | Shared compact density owns cell padding through spacing tokens. Existing consumers retain regular density. |
| `apps/web/src/features/social/social.css:103` | Unbounded directory and forced narrow horizontal scroll | Bounded directory; flexible rivalry columns with secondary date omitted at narrow widths. |
| `apps/web/src/features/collaboration/ParticipantName.tsx:33` | Social identity presentation lacked useful disambiguation | Shared optional username line uses secondary text, label size and normal weight. Other participant consumers retain name-only presentation. |

All colors, typography, spacing and interaction transitions use existing shared tokens/primitives. Feature-owned dimensions are the 1000px page maximum, 28rem directory bound and table column proportions. The 620px breakpoint follows existing workspace responsive behavior. No new animation path; shared table motion retains reduced-motion support.

Usernames come from the canonical auth account through an issuer-scoped identity binding, not a copied product field or a derived display name. Existing lowercase validation and `auth_username_unique` enforce global uniqueness. Authless/username-less accounts display their name without fabricated handles. Search accepts display names and usernames with optional @. Raw IDs are absent from visible text; stable UUID routes survive username edits.

Validation: seven real PostgreSQL/HTTP tests, including duplicate username rejection, canonical username updates and unrelated-issuer exclusion; 705 web tests passed (two skipped); API/web typechecks, contract and focused lint checks passed. Live Vite at `http://127.0.0.1:5189/social`, from `/Users/engai/.codex/worktrees/social/quorem/apps/web`: username search with keyboard submission, profile navigation, desktop/390px, light/dark, compact/bounded lists. Reduced-motion emulation and hosted/load testing remain unperformed.

Link feedback: shared `apps/web/src/ui/links.css` owns underline-free text/identity links, 120ms token-based color/background fades and reduced-motion suppression. Removed remaining web CSS link underlines in workspace, Social, admin and auth. Root DESIGN.md records the rule. No new player-table columns were added; suggested next columns are 90-day record, match count and viewer head-to-head.
