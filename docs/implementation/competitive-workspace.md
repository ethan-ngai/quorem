# Competitive workspace

Issue #26 updates the private 1v1 flow.

## Behavior

- Centered, animated match creation; segmented difficulty and Radix duration selection.
- Compact lobby with participant readiness, invitation copying and explicit settings application. Changed rules reset readiness.
- In-match score, presence and remaining time share a compact bar above the editor. Forfeit requires confirmation.
- One active competition per owner remains enforced by server reservations; multiple browser windows remain supported.
- Browser-only drafts/history; see [migration and backup guidance](browser-drafts.md).
- Python assistance follows the focused window. Background windows pause assistance while retaining their editor buffers; indentation guides remain local.
- CodeMirror draws the caret and selection; desktop Safari no longer depends on its native caret rendering.

## Evidence

- Two browser identities joined, readied and entered the editor on the migrated preview database.
- Admission rejected a second competition for the same owner.
- Immediate reload retained browser edits; local completion accepted `print` with Tab; indentation guides rendered in Darcula.
- `make check` and `make build` passed. Real PostgreSQL tests used a separate disposable database; real Docker language-session tests covered ownership transfer and cleanup.
- Native Safari Tab/Shift+Tab and arrow-key sampling showed no long JavaScript/frame stall. Switching to CodeMirror's cursor resolved the perceived lag in user validation; temporary profiling UI was removed.

## Limits

- Preview uses a clone of the development database; the original database and private legacy export remain preserved.
- Focused-window assistance reduces duplicate engines, but full Python analysis still runs in the language service. Public load and browser latency budgets remain release gates.
