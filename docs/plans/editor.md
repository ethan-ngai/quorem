# Editor — first milestone

Confirmed: solo practice, Python, CodeMirror 6, scoped Python IntelliSense, real judge, browser-only drafts and history, mocked multiplayer state. System theme + override, restrained blue, Geist Sans/JetBrains Mono. Desktop-first with usable narrow-screen fallback.

## Workspace

Confirmed desktop layout: statement/examples/constraints left, editor right, results below editor; resizable panes. Compact Run/Submit controls. Pane preferences and keyboard controls belong in acceptance. Mock opponent/timer indicators must be clearly fixtures and separated from authoritative session state. No marketing/dashboard work before this flow. Root DESIGN.md records confirmed visual direction and initial tokens.

TanStack Router owns URLs/navigation. TanStack Query owns remote snapshots and requests. Keep cursor, selection, undo, pane size, and unsaved buffer in local/editor state; never route each keystroke through server cache. Prefer TanStack packages when suitable, rather than adding unnecessary packages to satisfy a brand preference.

## Behavior

1. Open stable problem URL; fetch public immutable problem version and load this browser's owner-scoped draft.
2. Restore source for that version/language; otherwise initialize the Python template.
3. Persist latest source locally on edits; debounce bounded IndexedDB history. Keep active buffers independent across windows; reload resumes latest browser draft. Never send code to the server except Run/Submit snapshots.
4. Run snapshots current source against public examples and custom inputs using the public typed codecs.
5. Submit snapshots current source against hidden cases. Receive job ID, show pending/running, then verdict.
6. Edits after dispatch do not alter that job; results identify the evaluated snapshot. Preserve source on errors.
7. Recover completion by polling/snapshot after disconnect or reload. Prevent duplicate dispatch with idempotency.

Browser draft keys include owner, immutable problem version and language; match drafts additionally include their private workspace ID. Practice drafts survive replacement server workspace IDs. Latest source writes coalesce after cursor paint, with synchronous flush on page closure, context changes and explicit save; IndexedDB history retains 100 snapshots for 30 days. Other windows never replace the active buffer or require takeover; latest local write resumes on reload. Preserve empty drafts, old recovery data, identity isolation and newer edits during restore. No server draft endpoints or draft tables.

## States

Loading, empty template, editing, dirty, saving, saved, offline, recovery available, queued, running, accepted, wrong answer, syntax/runtime error, time/memory/output limit, invalid output, cancelled, judge unavailable. Submit: verdict, passed/total, safe summary; no hidden inputs/expected outputs. Run: bounded public/custom diagnostics. One queued/running job per user. Run/solo Submit cancellable; admitted match Submit irrevocable. Cancellation reflects actual fencing/teardown.

## Editor engine and language intelligence

Confirmed: CodeMirror 6 with Python IntelliSense in the first milestone; separate local backend language service behind an adapter, cloud hosting selected later. Required: type-aware completion, hover documentation, signature help, and syntax/type diagnostics. Navigation, refactoring, and formatting are deferred. Basic keyword completion alone does not meet this milestone.

Existing extensions cover highlighting, indentation, bracket handling, folding, undo/history, search, selections, completion UI, and diagnostic display. Python language support provides keyword/builtin completion; this is not type-aware intelligence. Configure problem-specific starter symbols/snippets explicitly without exposing hidden test data.

Official `@codemirror/lsp-client` supports language-server integration for completion, hover, signatures, definition navigation, rename, formatting, and references. Pin versions and verify the required feature set before implementation. Monaco does not automatically include VS Code's Python extension services either.

Keep language assistance separate from execution/judging. Language-service input uses the editable public document and public harness declarations only. Local service connects through an authenticated, owner-scoped transport adapter. Keep one bounded workspace/session context per owner/editor session; document lifecycle, idle cleanup, reconnect, and process/resource limits. Select the language server and any formatter through a capability spike against the agreed checklist; LSP protocol support alone does not guarantee server feature support. Cloud hosting remains a separate ADR; compare typing latency, runtime compatibility, isolation, connection/session lifecycle, and per-user resource limits. Long-lived language-server processes cannot be assumed to fit an API Lambda lifecycle.

Browser-worker delivery is deferred, not ruled out. The TypeFox browser Python fork inspected during planning is archived: [repository](https://github.com/TypeFox/pyright). A future browser adapter needs a maintained build and the same capability tests.

Language-service failures must preserve editing, basic completion, Run, and Submit. Version requests/diagnostics against document revisions; discard stale responses. Avoid synchronizing every keystroke into application state or judging queues. Dispose workers/connections on workspace teardown and scope sessions to owners.

Sources verified during planning: [core extensions](https://codemirror.net/docs/extensions/), [Python package](https://github.com/codemirror/lang-python), [official LSP API](https://codemirror.net/docs/ref/#lsp-client), [Monaco FAQ](https://github.com/microsoft/monaco-editor#faq).

## Design gate

Root DESIGN.md records confirmed direction and initial paired theme/syntax tokens, typography, spacing, shapes, layout and motion. Reference repos contribute open composition, restrained accents, compact metadata and purposeful feedback. Q2/Q5 validate contrast/geometry; marketing-scale type and ambient motion do not transfer to the editor.

Modern vanilla CSS; semantic HTML, visible focus, contrast, reduced motion. Current stable Chromium/Firefox/WebKit; keyboard and 200% zoom. Narrow fallback: accessible Problem/Code/Results tabs preserving state. Ctrl/Cmd+Enter Run, Ctrl/Cmd+Shift+Enter Submit, Ctrl/Cmd+S save; display shortcuts and allow disabling. System theme until persisted override.

## EditorView integration seam

Q5 owns `PythonEditor` and EditorView lifecycle. Contract: initial document/workspace key, theme/preferences, optional intelligence extensions, source-change callback, get-source/focus/apply-edit commands. Q5a owns extensions/language-session client; integration waits for Q5 seam freeze. Reconfigure extensions without remounting/replacing document on status/query changes. Workspace/version change deliberately initializes a new document after recovery. Never share EditorView between identities.

## Acceptance

- Real seeded Python problem: load, edit, Run, Submit, inspect results, reload, recover draft.
- Python language intelligence operates on typed Solution starter signatures, ListNode/TreeNode declarations, and user edits; verify type-aware completion, hover documentation, signature help, syntax/type diagnostics. Language-service recovery and stale-response handling require integration tests. Navigation/refactoring/formatting do not block this milestone.
- Verify undo/cursor survive ordinary query refreshes and status events.
- Keyboard-only operation, named icon buttons, accessible splitters, focus restoration, readable status announcements.
- No hidden case/source leakage into bundles, responses, or mocked opponent state.
- Integration tests: duplicate click, source edit during execution, concurrent browser windows, reload pending job, backend unavailable, reordered events.
- Visual verification against confirmed DESIGN.md at agreed viewport sizes; inspect actual browser behavior and console.
