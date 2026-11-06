# Frontend review — issue #560

Baseline `67a5051b`; read-only source review, 2026-11-05. Protected dirty table/search files and `table-page-size-review` artifacts excluded from proposed edits. Findings are hypotheses from source inspection; no runtime validation yet.

## Coverage and limits

Inventory: 466 files under the three source roots: web 437 (includes one untracked review artifact), marketing 25, shared UI 4. Web features: admin 43, auth 35, collaboration 7, editor 142, execution 2, interviews 25, matches 25, navigation 13, odyssey 17, practice 16, public 5, realtime 6, rooms 6, settings 4. Web also has API, assets, styles, test and 71 UI files. Marketing: 19 components, 2 pages, 1 script, 2 styles, 1 asset. Shared UI: theme, controls, tokens, SEO. Web public has 31 files; generated/vendor and binary assets were inventoried, not audited. Largest sources: marketing CSS 3,388 lines, workspace CSS 1,344, WorkspacePage 907, InterviewPage 726. Size alone is not a defect.

Inspected DESIGN.md and theme foundations; traced workspace, editor draft/execution flows, interview counterpart, shared overlay and splitter, marketing motion, dependencies and representative design-token exceptions. All feature groups inventoried; not all source files, visual values or interactions read. No browser, accessibility, performance or package-maintenance verification; no exhaustive design-token compliance claim. Marketing's separate brand contract requires independent verification before changing its values. No test commands run.

## Findings

### P1 — Pointer splitter can continue dragging after cancellation

`apps/web/src/features/editor/components/ResizableDivider.tsx:19-37` captures a pointer and registers window `pointermove`/`pointerup`; `pointercancel`, lost capture and unmount do not remove listeners. A cancelled touch or a route change during drag can retain the callback and respond to subsequent pointer movements. Both splitters in shared `WorkspaceLayout.tsx:70-85` affect practice, match and interview (`WorkspacePage.tsx:653`, `InterviewPage.tsx:406`). Owner: `ResizableDivider`. Use captured React pointer move/up/cancel/lost-capture handlers, or explicit lifecycle cleanup with pointer-ID filtering. Preserve clamping, x-percent/y-pixel geometry and keyboard semantics. Validate pointer cancellation, unmount, unrelated pointers, both axes and keyboard; browser touch/desktop resize.

### P2 — Draft recovery protocol is embedded in the workspace page

`WorkspacePage.tsx:131-162,208-284,286-365,530-570` spreads context identity, queued writes, generation guards, browser flush, recovery and restore across one 907-line controller. Page composition, query state and persistence invariants must be changed together; tests of recovery storage cannot alone verify these cross-event races. Owner: editor draft lifecycle, not layout or interview collaboration. Extract one cohesive controller/hook that owns the context transition, source change/save/restore and lifecycle cleanup; return explicit save state and commands to the page. Avoid a generic persistence framework or merging interview's separate synchronized document model. High risk: preserve anonymous migration, storage scopes, pending writes, stale-context/generation checks, source/undo/focus and unload behavior. Validate existing recovery tests plus integration tests for edits during restore, context/language switches, delayed failures and pagehide; exercise practice and match in browser.

### P2 — Run snapshots repeat admission-time mapping across modes

`apps/web/src/features/editor/useSubmission.ts:213-231` and `apps/web/src/features/interviews/InterviewPage.tsx:254-264,285-302` both parse custom drafts and map admitted cases to stable draft IDs and `caseSnapshotValue`. A change to this contract needs synchronized updates to both paths; mismatches could attach results to edited/reordered inputs. Owner: editor custom-case/snapshot domain, e.g. a focused helper adjacent to `customCases.ts`, parameterized by already-selected examples and problem. Keep admission, source hash, question epoch, interviewer visibility, concurrency and query lifecycle in their respective controllers; don't unify their distinct protocols. Validate custom/example cases, edits/reorder, Odyssey examples, run versus submit, private-test boundaries and mode-specific result tests.

### P3 — Custom-draft write policy has two owners

`WorkspacePage.tsx:469-477` and `InterviewPage.tsx:197-203` duplicate optional-storage JSON writes; `customCases.ts:251-281` already owns key and reads. Put a small `writeCustomDrafts(scope, drafts)` alongside read and remove both copies. Preserve workspace's current context ref and interview's question-epoch scope; storage failure must remain nonblocking. Validate independent scopes, reload and unavailable storage. This is independent of the draft lifecycle extraction if integrated first.

### P3 — Tooltip overrides shared elevation and motion

`apps/web/src/ui/tooltip.css:9-11,17-18` hardcodes shadow and timings rather than theme owner `packages/ui/src/theme.css:68-72,76-77`; shadow persists in dark mode although DESIGN.md elevation is none there. Every `Tooltip` consumer inherits this divergence. Give tooltip the appropriate shared elevation and motion tokens (introduce exact small elevation if necessary, rather than reuse a visually different overlay shadow); preserve reduced-motion rule and existing geometry. Verify light/dark, hover, focus, tooltip entry/exit and reduced motion across representative editor, navigation and interview consumers. Other observed hardcoded values include `session-dialog.css:82`, `workspace.css:69,664,780,1101,1122`, navigation CSS 85/177/345, settings CSS 73 and editor-surface CSS 43-44; backdrops, syntax palette fallbacks and deliberate geometry need semantic classification, not mechanical token replacement. Full visual audit remains open.

## Package assessment

Existing Radix Dialog/Popover/Tooltip/Select and TanStack Query/Router/Table are already canonical foundations; prefer them to new overlay, query or table abstractions. Splitter lifecycle is small enough to repair directly; evaluate a maintained splitter package only if it demonstrably preserves existing controlled values, capture/cancellation, keyboard, accessibility, bundle cost and desktop/mobile layout. No new package proposed without maintenance, license, API and actual behavior verification. Marketing already gates hero motion on visibility, hidden tabs and reduced-motion (`heroDots.ts:52-58,182-198`); don't replace it based on file size alone.
