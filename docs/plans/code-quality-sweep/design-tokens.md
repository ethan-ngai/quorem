# Design token inventory — issue #560

Baseline `c355085b`. Scope: `DESIGN.md`, marketing brand contract, all CSS under web/marketing/shared UI, Astro `<style>` blocks, `apps/web/index.html`, and static visual-literal/style searches across TS, TSX and Astro source. Classification is by declaration/consumer class; it is not a manual interaction audit. SVG/image assets, third-party generated DOM/CSS and browser-computed values were not exhaustively examined.

## Coverage

Source inventory: web 441 CSS/TS/TSX files (53 CSS; 321 non-test files), marketing 24 (2 CSS, 14 Astro, 4 TSX, 4 TS), shared UI 4 (2 CSS, 2 TS). Six marketing Astro files contain style blocks; web HTML contains the initial-paint theme style. Regex inventory of color, background, border, font, shadow, animation and transition declarations, including relevant custom properties: web 1,483; marketing 527; shared 118. Of these, 920 / 334 / 36 respectively contain `var()`. Counts are lexical, not a CSS parser: nested functions, multiline constructs, shorthands, comments and arbitrary JSX expressions preclude a claim that every computed value is resolved. A separate literal/style search covered non-test code and 180 editor-palette color occurrences. CSS dimensions/spacing also inventoried: 1,410 matching lines across all three source roots; feature dimensions and diagram geometry are deliberately not forced onto spacing tokens.

| Area | Files with styles | Visual declaration matches | Classification |
| --- | ---: | ---: | --- |
| Web admin | 3 | 123 | Shared input/focus tokens; authoring fields and diagrams own size/geometry. |
| Web auth | 4 | 101 | Shared theme/form tokens; auth illustration owns decorative depth and geometry. |
| Web collaboration | 1 | 7 | Participant identity color and derived presence highlight. |
| Web editor | 9 | 246 | Editor palette/context variables, syntax and node diagrams; editor frame has distinct inset shadows. |
| Web interviews | 1 | 16 | Session-specific controls composed from shared primitives. |
| Web matches | 1 | 136 | Competitive controls; shared semantic/motion tokens, feature-specific score and spinner geometry. |
| Web navigation | 3 | 97 | Shared tokens, avatar identity fallback and sidebar scrim/motion. |
| Web Odyssey | 2 | 28 | Stage/step controls, shared tokens and feature geometry. |
| Web practice | 1 | 66 | Table/filter controls and token-derived color mixes. |
| Web public | 1 | 64 | Shared content typography and theme tokens. |
| Web rooms | 1 | 16 | Shared notice/popover tokens and room-specific geometry. |
| Web settings | 1 | 57 | Shared theme tokens; settings layout and loading indicator dimensions. |
| Web global/workspace | 2 | 278 | App shell, editor panes, backdrop and legacy selectors; see exceptions below. |
| Web UI | 23 | 248 | Shared primitives, token-driven focus, overlay, controls and motion. |
| Marketing styles/Astro | 8 | 527 | Brand/artwork surfaces, illustration geometry and shared product-preview tokens. |
| Shared foundations | 2 | 118 | Canonical light/dark values and cross-app control defaults. |

## Classification and review

- **Canonical tokens.** `packages/ui/src/theme.css` owns color, font, spacing, radius, focus and motion variables; `tokens.ts` owns JS values. Shared components generally use these or inherit them. `theme.css` must contain literal definitions. `apps/web/index.html:19` duplicates background colors intentionally for first paint before app styles load; browser chrome metadata and mask icon literals are not component colors.
- **Feature geometry.** Per-pane min/max/ratios, breakpoints, table widths, icons, preview scale, node layout, spacing that accommodates content and SVG coordinates are dimensions, not palette/elevation defaults. Inline dynamic geometry occurs in `WorkspaceLayout`, `ResizableDivider`, `NodeDiagram`, `NodePreview`, `PageSizeControl` and `SegmentedControl`. The stylesheet media breakpoint cannot directly consume a CSS custom property.
- **Editor/syntax.** `editorPalettes.ts` supplies selectable named schemes, including light/dark colors and user cursor; `editorPalette.ts`, `syntaxHighlighting.ts`, `semanticHighlighting.ts` and `pythonHighlighting.ts` consume these. `code-literal.css` has independent fallbacks for standalone previews. Do not replace palette literals with workspace color tokens. Editor-surface inset shadows describe edge framing, not floating elevation. Per-user editor font size is a setting; authoring/marketing previews use deliberate smaller sizes.
- **Identity/provider artwork.** `participantColor.ts`, `PageLayout.tsx`, `ProfileSettings.tsx`, `presence.css` and navigation avatar fallbacks preserve stable participant identity; Google icon colors are provider artwork. Their literal/derived colors are not shared semantic-color defaults.
- **Marketing brand/artwork.** Silkscreen in `HeroSlogan.astro` and wordmark artwork follow `docs/implementation/marketing-brand.md`. `marketing.css` defines illustration-specific `--marketing-depth`, surface highlights, edge masks and preview shadows, including dark values; these depart from the workspace elevation scale and need visual design judgment, not automatic replacement. `HeroDots` masks and SVG illustration positions/timing are artwork; `HeroEditorPreview`/`EditorPreview` explicitly scale real editor surfaces.
- **Semantic blends and focus.** `color-mix()` in practice, collaboration and node preview derives from a current semantic/identity token; inset border/focus shadows communicate selection rather than elevation. `--shadow-overlay` is a separate 0 6px 20px preset for popovers/selects/toasts, not the DESIGN.md small or medium elevation; it is dark-none. Unifying its geometry would change every overlay and requires visual review.
- **Motion.** Product control entry/selection generally uses `--motion-fast`, `--motion-standard` and `--motion-easing`, with reduced-motion rules. Durations 800–900ms/1s are repeated spinners; 1ms and 0.01ms are reduced-motion overrides; `0s` handles visibility timing. Sidebar 240ms/custom easing, settings/session 140–160ms exits/backdrops and workspace's custom ease are choreographed feature motion, not identical defaults. Marketing sequences and canvas animation are separate artwork. CSS inventory does not establish that every interaction has a reaction or that animations render at 60fps.
- **Remaining design-review candidates.** `workspace.css` settings backdrop and `session-dialog.css` backdrop use the same `#0005` and 160/140ms animation values under separate owners; sharing those rules needs focus/dismissal and transition verification. Navigation's `sidebar.css` scrim uses a distinct 40% black. The `settings-dialog` generic shadow is overridden by `settings.css` for the only current `SettingsDialog` consumer (`unified-settings`); `MatchEndView` uses only the backdrop. `auth.css` login illustration has a bespoke depth shadow, including in dark; inspect the visual before deciding whether its decorative treatment conflicts with dark-mode elevation. There is no basis to mechanically collapse backdrops, inset edge effects, marketing shadows or syntax fallbacks into one elevation token.

## Changes and verification

`--shadow-sm` and `--shadow-md` now name exact DESIGN.md small/medium values with dark `none`; the tooltip, account navigation and settings consume them. Existing overlay preset remains unchanged. Workspace interaction 120/180ms aliases, competitive progress 180ms and shared session-dialog entrance 180ms now use the identical canonical motion values; feature-specific easing remains intact. Source search found no consumer for `.problem-menu`, `.concession-dialog`, or `.problem-picker summary`; removed those obsolete rules, retaining the current Radix problem picker and session dialog. No feature dimensions or marketing visuals changed.

Browser evidence supplied by orchestrator: practice desktop light/dark, narrow layout, splitter and reload. Settings/navigation overlay checks are pending. Admin/interview flows, live reduced-motion emulation, all interaction states and exhaustive contrast/visual inspection remain unverified. This static inventory does not imply complete design conformance.
