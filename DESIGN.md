---
name: Quorem Workspace
description: "A compact coding workspace led by Linear: calm tonal surfaces, soft edges, direct problem hierarchy, and restrained blue actions."
colors:
  primary: { light: "oklch(0.54 0.22 260)", dark: "oklch(0.68 0.165 260)" }
  brand:
    primary: { light: "oklch(0.54 0.22 260)", dark: "oklch(0.68 0.165 260)" }
    secondary: { light: "oklch(0.94 0.04 260)", dark: "oklch(0.28 0.065 260)" }
    accent: { light: "oklch(0.50 0.21 260)", dark: "oklch(0.72 0.14 260)" }
    onPrimary: { light: "oklch(1 0 0)", dark: "oklch(0.15 0.006 255)" }
  neutral:
    inlineCode: { light: "oklch(0.93 0.004 255)", dark: "oklch(0.145 0.004 255)" }
    background: { light: "oklch(0.97 0.003 255)", dark: "oklch(0.18 0.004 255)" }
    surface: { light: "oklch(0.985 0.002 255)", dark: "oklch(0.205 0.005 255)" }
    overlay: { light: "oklch(0.95 0.004 255)", dark: "oklch(0.25 0.008 255)" }
    field: { light: "oklch(1 0 0)", dark: "oklch(0.205 0.005 255)" }
    border: { light: "oklch(0.90 0.004 255)", dark: "oklch(0.28 0.006 255)" }
    text:
      primary: { light: "oklch(0.24 0.006 255)", dark: "oklch(0.91 0.004 255)" }
      secondary: { light: "oklch(0.45 0.008 255)", dark: "oklch(0.73 0.008 255)" }
      disabled: { light: "oklch(0.59 0.005 255)", dark: "oklch(0.52 0.006 255)" }
  semantic:
    info: { light: "oklch(0.52 0.18 260)", dark: "oklch(0.70 0.14 260)" }
    success: { light: "oklch(0.58 0.175 145)", dark: "oklch(0.73 0.16 150)" }
    warning: { light: "oklch(0.816894 0.136542 74.39175)", dark: "oklch(0.78 0.15 75)" }
    error: { light: "oklch(0.60 0.23 27)", dark: "oklch(0.70 0.19 25)" }
  editor:
    selection: { light: "oklch(0.90 0.04 255)", dark: "oklch(0.32 0.05 255)" }
    activeLine: { light: "oklch(0.97 0.008 255)", dark: "oklch(0.23 0.009 255)" }
    keyword: { light: "oklch(0.40 0.13 285)", dark: "oklch(0.77 0.10 285)" }
    string: { light: "oklch(0.40 0.08 155)", dark: "oklch(0.76 0.08 155)" }
    number: { light: "oklch(0.42 0.09 60)", dark: "oklch(0.77 0.09 60)" }
    function: { light: "oklch(0.42 0.12 255)", dark: "oklch(0.77 0.10 255)" }
    comment: { light: "oklch(0.45 0.008 255)", dark: "oklch(0.70 0.008 255)" }
typography:
  h1: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "24px", fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.025em" }
  h2: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "24px", fontWeight: 550, lineHeight: 1.25, letterSpacing: "-0.02em" }
  h3: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "19px", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" }
  body: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
  label: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "12px", fontWeight: 500, lineHeight: 1.5 }
  monospace: { fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
rounded: { sm: "6px", md: "8px", lg: "10px", full: "9999px" }
spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", xxl: "64px" }
elevation:
  sm: { light: "0 2px 8px oklch(0.2 0 0 / 0.06)", dark: "none" }
  md: { light: "0 8px 24px oklch(0.2 0 0 / 0.08)", dark: "none" }
  lg: { light: "0 16px 48px oklch(0.2 0 0 / 0.10)", dark: "none" }
---

## Overview

Transient failures use Sonner notifications at the top right, below the navigation, with existing overlay/text/border/error tokens, dismiss controls and reduced-motion support. They never insert space into a form, lobby or editor. Keep field validation, compiler diagnostics/verdicts and blocking page states with their recovery controls in context. Deduplicate repeated background errors; notifications remain visible above modal dialogs, including native draft history.

Linear is the primary application reference: one compact 48px top navigation row, nearly uniform neutral surfaces, subtle edges, 6-10px radii, and 14px interface text. Coding sites inform reading order: 24px title, difficulty, optional Topics, immediate prose, one Examples heading without visible numbering, named input/output fields, then ordinary constraints. Inline and example code values use a distinct neutral background with compact 2px/5px padding and 3px corners; each pair reserves space for its optional explanation. Topics use an eye show/hide control beside difficulty and title-cased labels with a subtle neutral background and small corners in reserved space between difficulty and description; hiding keeps its layout space. Preserve the portfolio/CUXR font and tonal restraint without their editorial framing. Remove ornamental eyebrows, repeated pane titles, version numbers, file encodings, normal connection chatter, and visible source hashes. Keep actionable errors and recovery. Run and Submit occupy the bottom of the shared solution surface, right aligned. On narrow screens that action row remains visible in every workspace pane. Samples and Custom cases are the two case collections; execution results attach to their admitted case snapshot rather than a separate Test result tab. Following [HackerRank sample test cases](https://candidatesupport.hackerrank.com/articles/1258064241-sample-test-cases), individual cases occupy a left rail with independent scrolling and a subtle vertical divider. Selected rows use a quiet neutral fill and medium weight. The right detail scrolls independently; a Run verdict spans both columns above them. Public examples show named inputs and expected output. Custom cases have one labeled control per signature argument, optional expected output, and add/remove controls; their wire representation remains an ordered typed args array. Typed preset controls expose fixed collection brackets, numeric expression inputs, plain text and boolean choices. Nodes retain codec-defined level/order semantics; nested/custom controls come from registered presets. Show validation errors, omit routine format hints. Optional expected output is added or removed with a quiet action, preserving its value when removed. Run result details display only authoritative public output and expected values, never current editable inputs. Submit displays verdict, score and safe errors only. The question sits directly on the dark page background, without an enclosing card. Inline/example code uses the darker inlineCode token. Test values use the dark inlineCode background, 5px/8px padding and 6px corners. Case input/output icons align with the first 18px text line, including its 5px vertical padding. Editor, tests and bottom execution actions form one flat field-toned surface without an outer border or rounded corners; keep the internal editor/tests divider inset 18px on each side, aligned with test controls. No editor or testing cards. Remove outer workspace gutters on all screen sizes: editor, tests and action backgrounds extend to the screen edges, directly below navigation. Keep padding inside individual content areas. The vertical resize handle occupies the page-colored gap; its single 1px divider sits at the solution edge where the background changes. Hover/focus highlights the divider. Editor/test controls share an 18px visible left inset: compensate for the language selector's internal padding, remove extra gutter padding while keeping three-digit number capacity, and inset case labels to align with test tabs and status text. The editor has a bounded internal horizontal scroller with a visible horizontal scrollbar whose rounded thumb starts/ends at the same 18px control inset; use a uniform transparent 3px border and padding-box clipping for round ends; preserve the wrap preference. The entire desktop sidebar column, including the top-bar toggle segment, uses surface grey continuously from the top edge; its links retain transparent backgrounds. When the preview rail is hidden (900px and below), open/close controls use the black/page background. The navbar bottom stroke starts to the right of the desktop rail and spans the full width on smaller screens; fade its first and last 24px into transparency. No nested card shells, gradients, glass, or decorative motion.

System theme is the initial preference; explicit light/dark override persists. The editor remains the focal point. These initial tokens translate confirmed direction; contrast, syntax readability, layout dimensions, and font rendering require actual browser validation before implementation acceptance.

## Colors

Neutrals occupy most of the workspace. Blue communicates selected controls, focus, and the primary action. Success/warning/error colors communicate verdicts alongside text/icons, never alone. Use field for editor/input backgrounds, surface for panes, overlay for popovers, border for rules. Use editor colors only for syntax/selection, not decoration. Focus uses an accent outline with offset, not a border-only color shift.

## Typography

Geist Sans carries interface and problem prose; JetBrains Mono carries code, inputs, outputs, and machine values. The UI scale approximates recursive multiplication of 12px by sqrt(phi). Compact labels never replace readable body text. Keep editor text configurable without changing interface scale. Self-host fonts with fallbacks. Headings remain left-aligned. Editor ligatures are disabled: `font-variant-ligatures: none` and `font-feature-settings: "liga" 0, "calt" 0` on the CodeMirror root, content, and gutters. Operators must retain literal characters.

## Layout & Spacing

These theme-independent layout tokens extend the YAML schema through this table; map them to shared CSS custom properties during implementation.

| Token | Value |
| --- | --- |
| workspace-breakpoint | 900px |
| statement-max-width | 68ch |
| problem-pane-initial | 40% |
| editor-pane-initial | 60% |
| pane-minimum | 280px |
| results-initial-height | 260px |
| control-height | 32px |
| navigation-height | 48px |
| narrow-touch-target | 44px |
| case-rail-width | clamp(100px, 16%, 140px) |
| narrow-case-rail-width | 104px |

Desktop: problem left, editor right, results below editor; no marketing width cap on the workspace. Initial split is 40/60 and remains user-resizable. Results resize vertically. Support keyboard splitters with named controls and size announcements. Below the breakpoint, place problem/editor/results in accessible tabs or a single-column flow; choose the precise narrow-screen interaction during implementation review. Preserve source/scroll/focus on switching. Use tokens for gutters and spacing; measure rather than assume pane minima fit every device.

## Elevation & Depth

Separate panes with thin rules and surface changes. Light-theme popovers/modals may use elevation tokens; dark-theme overlays use borders and tonal separation. Avoid decorative shadows on workspace panes.

## Shapes & Corners

The question has no outer enclosure; editor/results/actions share one square, borderless outer surface; buttons/fields use 6px and overlays use 8px. Reserve full rounding for avatars/status markers. Avoid nested card shells.

### Account menu

Translate the supplied dark account-menu reference into the compact workspace scale: 260px maximum width (viewport minus 16px), 12px identity-header padding, 36px circular avatar with no stroke or shadow, 14px medium-bold name above 12px muted email, 32–36px icon/text action rows (44px for coarse pointers) and subtle dividers. Use overlay/border/text/error tokens; dark has no shadow, light uses subtle overlay elevation. Logout is red after the footer divider. Include only working account/profile/theme/admin actions; no fabricated streak or billing data. Workspace settings is a separate icon immediately left of the profile trigger. Photo-less avatars use only the first name letter (username fallback) in an HTML element, white on a fixed neutral gray background (#666666); never image generation, image URLs or image placeholders.

## Animation

Theme-independent motion tokens: `motion-fast`: 120ms; `motion-standard`: 180ms; `motion-easing`: cubic-bezier(0.2, 0, 0, 1). Map them to shared CSS custom properties.

Brief color/opacity/transform feedback clarifies hover, selection, saving, and popovers. No ambient animation while coding. Reduced motion removes spatial transitions. Loading/status animation must not move code or result geometry.

Shared Radix selects open and close with a 120ms opacity/98%-scale animation anchored to the trigger. The chevron rotates on opening and returns on closing. Reduced motion disables both animations.

The code toolbar reserves 8px above its controls, no bottom padding, and sizes to fit narrow-screen touch targets.

IntelliSense uses a circular, non-clickable 8px status dot with a steady glow: success green when active, warning yellow when connecting/paused, error red when unavailable. A keyboard-accessible tooltip explains the state.

Light-mode semantic labels favor vivid classic hues; yellow matches the supplied reference text, sampled as `#f7b553`. Body text and button labels retain AA contrast. Light-mode accent tokens brighten indicators and fills: success `oklch(0.66 0.20 145)`, warning inherits the reference yellow, error `oklch(0.64 0.24 27)`. Dark accents inherit their existing semantic colors. Glow uses 4px/65% and 9px/35% accent shadows; no pulse.

## Components

- Buttons: Submit uses primary/onPrimary; Run uses neutral surface/border. Busy state names the existing job rather than silently accepting another.
- Fields: field background, readable text, visible focus; validation includes explanatory text.
- Editor: stable cursor/undo; color scheme changes reconfigure visual extensions in place. Completion, brackets and selection use editor-scoped palette colors; diagnostics include accessible explanations.
- Results: semantic icon/text, source snapshot association retained in data, bounded output, stable space for status transitions.
- Links: visibly identifiable and keyboard-focusable; use brand accent for navigation links.
- Status: no saved/saving/unsaved indicator during routine autosave; retain persistence failures and retry controls. Toasts never hold the only recovery action.

## Rules

Use shared CSS custom properties and inherited typography. Match all colors to theme tokens. Preserve keyboard access, WCAG AA contrast, readable zoom, reduced motion, and sensible narrow-screen touch targets. Verify computed contrast in both themes, including syntax and overlays. Keep factual copy and functional labels. Introduce token changes in this document before propagating them into components.

## Editor color schemes

Editor color scheme is independent of the app theme and persists on this device. Workspace follows the app light/dark tokens. JetBrains Light, Darcula and One Dark retain their own light/dark surfaces, gutters, cursor, selection, bracket and tooltip colors. Palette variables are scoped to the CodeMirror editor; they do not recolor navigation or results. Ligatures remain disabled in every scheme. Gutter background matches code; tabular line numbers align right within a minimum three-digit width, and folding uses small stroke chevrons with quiet hover feedback.

References: [JetBrains Default and Darcula source](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/DefaultColorSchemesManager.xml), [CodeMirror One Dark source](https://github.com/codemirror/theme-one-dark/blob/main/src/one-dark.ts). These are adapted palettes: Low-contrast syntax and gutter colors are adjusted against each scheme's active-line surface for readability; JetBrains Light function definitions receive a brown accent. Workspace inherits existing surface/syntax tokens. Its class accent is #876b13/#e5c07b (light/dark), parameter #815c23/#d7b88b, and builtin/decorator #7c3f8c/#c792ea; self uses the keyword token.

| Editor token | JetBrains Light | Darcula | One Dark |
| --- | --- | --- | --- |
| background | #ffffff | #2b2b2b | #282c34 |
| foreground | #242424 | #a9b7c6 | #abb2bf |
| gutter | #ffffff | #2b2b2b | #282c34 |
| gutterText | #666666 | #9d9d9d | #929cad |
| activeLine | #fffae3 | #323232 | #2c313a |
| selection | #d4e2ff | #214283 | #3e4451 |
| cursor | #242424 | #a9b7c6 | #528bff |
| tooltip | #f7f7f7 | #313335 | #353a42 |
| border | #d0d0d0 | #515151 | #4b5263 |
| keyword | #000080 | #e09049 | #c982dd |
| string | #067d17 | #a3be8c | #98c379 |
| number | #0000ff | #82aad0 | #d19a66 |
| function | #7a5600 | #ffc66d | #61afef |
| class | #7a5600 | #a9b7c6 | #e5c07b |
| builtin | #660e7a | #a3a3d4 | #56b6c2 |
| parameter | #705b33 | #d7b88b | #d19a66 |
| operator | #454545 | #a9b7c6 | #56b6c2 |
| decorator | #707000 | #bbb529 | #e5c07b |
| comment | #666666 | #9d9d9d | #929cad |
| self | #94558d | #e09049 | #e9848b |

Python highlighting follows the installed Lezer grammar: function definitions and calls (including method properties), class definitions, strings, numbers, comments, operators and decorator contexts. Parameter declarations use their parser context. Visible syntax-tree identifier spans recognize literal self/cls and common builtin names; this is lexical recognition, not inferred type/scope information. Builtin accents never replace function/class/parameter declaration or property coloring. Comments use italic style; ordinary identifiers retain the palette foreground.

Editor intelligence popovers use the small text token; documentation scrolls within 260px or 40vh and stays within viewport width. Local keyword/name completion remains available while remote analysis initializes.

Descriptions, explanations and prose constraints support inline code, bold, italics and KaTeX math. Structured constraints render machine references as text-fitting monospace code and quantities/operators as inline mathematics at the surrounding type scale. Code-editor ligatures remain disabled.

Use semantic icons alongside labels for sample/custom collections and input/output/expected values. Compact destructive actions use red trash icons with accessible names and tooltips. Collection focus belongs to the outer control only. Constraint inline code shares description code padding and tone.

Parameter names use monospace; input-purpose icons sit beside controls. Example input/output icons use tooltip and accessible names without visible labels. Pane tabs pair semantic icons with text. Destructive icon actions stay red and share aligned 28px targets.

Read-only case values share compact problem-example backgrounds. Parameter labels use monospace; purpose icons align beside values like editable controls. Expected output appears once, green; judged mismatches and failed verdicts use red, uncompared output stays neutral. Console streams occupy labeled neutral sections distinct from diagnostics.

Workspace motion uses one crisp 120–180ms easing family. Buttons, disclosures, links and tabs receive hover/press/focus transitions; inputs, checkboxes, editor completion/fold controls and resize handles receive state feedback. Native disclosures/dialogs and conditional fields fade on reveal. Topics retain their space and fade/translate in both directions; the eye remains visible when topics are visible, with an animated slash when hidden. Reduced motion removes displacement and shortens transitions. No typing, scrolling or resizing waits for motion.

Case rails use green checks/red crosses for associated results; stale edits clear status. Run summaries show compared passed/total counts without repeating collection names. Hidden-suite cases use colored locks and expose status only; values and diagnostics remain private. Presets own fixed delimiters: strings use quotes, collections/nodes use brackets; numeric/boolean controls and explicit structured fallbacks retain their native presentations.

Workspace hints use Radix Tooltip with a 100 ms hover delay, immediate keyboard focus, collision-aware portals, and subtle reduced-motion-safe fades. Use semantic icons with tooltip labels for example input, output, and explanation; keep explanation prose visible.

Settings use a centered Radix Dialog: 700px maximum width, 460px bounded height, a 160px independently scrollable section rail, and scrollable detail pane. A subtle dark backdrop fades with the modal; 180ms opening and 140ms closing use opacity/scale, with reduced-motion support. Use Radix Select for choices and Switch for booleans. Appearance, Editor, Shortcuts and Drafts retain existing persistence. Account identity and sign-out live in the profile menu; product UI never exposes fixture identity controls. Guests can inspect questions and edit code; IntelliSense requires a session, and Run/Submit offers sign-in with a return route. Shortcut tiles use interface type and symbolic key caps (⌘, ⇧, ↵), retaining accessible key names from the same definitions used by TanStack Hotkeys; shortcuts are always enabled, with workspace actions paused while settings is open.

Competitive screens reuse the workspace scale: 48px navigation, 24px lobby heading, players side by side in a compact row divided by subtle rules, and readiness actions visible without scrolling at typical laptop/mobile heights. Creation uses an animated centered Radix Dialog; difficulty uses mutually exclusive segmented buttons and duration/account use Radix Select. Keep factual copy, interface typography for status, monospace only for machine values, and icon tooltips for copy/leave/forfeit. During play, a 48px score-and-clock bar replaces the oversized ledger. Hide normal connection chatter; retain reconnect feedback. Browser drafts replace server autosave; concurrent windows keep independent live buffers, with the latest browser save used on reload.

Lobby headings name the game mode without instructional subtitles. Settings apply immediately and reset readiness through the server. Readiness uses tooltip-labeled muted clock/green circle-check icons; leave actions are red. Copy feedback morphs to a green check for two seconds, respecting reduced motion.

Mode-dependent titles and seat copy crossfade over the 120ms fast token with at most 2px displacement. The Start action uses the same timing to fade and collapse its slot; its hidden control is inert immediately. Retain label geometry during crossfades, keep pending locks immediate, and remove motion for reduced-motion preferences.

Invitation entry shows the real read-only lobby settings and seat count behind an automatically opened dialog. Signed-out regular invitations explain that an account is required and offer Sign in; signed-in users explicitly confirm Join lobby. View lobby dismisses without joining and preserves a way to reopen. Preserve the invitation destination through sign-in. Invalid/closed/full invitations never offer a join action. Preview omits player identities, invite controls and problem identity.

Invitation links pair Copy and native Share icon actions. The open seat mirrors the identical Copy/Share icon pair, tooltips and synchronized copy feedback; unsupported sharing copies the link with existing green feedback. Cancelling the share sheet is silent; failures retain manual copy recovery.

Showdown is the canonical mode: database/API ID `showdown`, display name Showdown, monochrome [Lucide Swords](https://lucide.dev/icons/swords) icon. Lobby Ready/Cancel share a fixed 104px action width; the check morphs into a cross and back, while overlaid labels crossfade and move 6px in opposite directions over 180ms. Reduced motion removes displacement. Readiness morphs clock hands into a green check and back in 180ms, without displacement or reduced-motion animation. Waiting text follows opponent presence first, then unready participants.

Settings Color theme uses an icon-only System/Light/Dark segmented control: Lucide monitor/sun/moon, tooltip names, pressed-state selection, shared neutral surfaces and hover/press transitions. Omit explanatory helper copy. Touch segments use 44px targets.

Global navigation shares one 48px row across practice, invitations and lobbies: brand, Radix practice picker, Create match or current mode, then contextual account/settings actions. Creation uses a centered bounded scrollable dialog. Shared lobby controls use icon mode segments, a compact headerless searchable Radix problem popover preceded by always-visible Difficulty segments whose adjacent selections share one continuous background, and Radix duration choices. Random uses Lucide Dices. Host rules appear only in the lobby, using Radix conduct choices. Free-for-all uses the monochrome premade [All for one](https://game-icons.net/1x1/lorc/all-for-one.html) icon by Lorc. Free-for-all uses the same compact two-column player rows as Showdown, with open seats inline and subtle dividers, an explicit host Start action, and a horizontally scrollable in-match score row. Conduct warnings use small semantic status rows; public announcements stay bounded and neutral.

## Marketing and discovery

Below the match walkthrough, Coming soon uses two full-width compositions. Social layers a clear head-to-head record over a wider leaderboard; Adaptive layers a problem recommendation over recent performance. Headers place feature titles left and descriptions right, stacking on narrow screens. Rear surfaces use broad multi-stop tonal falloff, then fade empty right/bottom gutters; scores and verdicts stay readable. Foreground shadows use three soft layers rather than a tight dark edge. Performance rows use native difficulty colors and topic pills, without a selected-row highlight. Foreground surfaces retain native corners, neutral fields and readable interface labels. Panels size to content, keeping side-by-side overlap on tablets and offset, lightly overlapping surfaces on phones. Adaptive puts the failed graph problem beside its recommendation; phone rivalry stats use a compact horizontal layout. Each feature carries a Coming soon badge. Records are illustrative, without algorithm claims or availability dates.

Marketing leads with private coding matches. Linear and Raycast inform fine linework and isolated functional details. Mode diagrams must explain the competition: one shared problem, independent contestants, submitted test counts and the first correct winner. Showdown places two contestants opposite each other; Free-for-all uses four parallel contestant lanes. Supabase informs asymmetric product surfaces. Ramp and Raycast inform generous spacing and isolated product detail. Use factual headings and compact descriptions, no slogans, fabricated metrics or decorative figure numbering. Geist display 56–112px, headings 36–64px; width 1280px, section spacing 80–128px. Two open mode illustrations precede an asymmetric feature composition. Product surfaces use 16px corners, 32–48px internal space and soft layered shadows; workspace styling remains unchanged. The hero imports PythonEditor alone; the test preview imports PythonEditor, TestCases and ResultContent as visible-only Astro islands, with the actual workspace stylesheet scoped to the preview. The toolbar uses the app's left-aligned monochrome Python logo and label, without a filename or caret. Sample/Custom case tabs and Run/Submit footer follow WorkspacePage. The editors are read-only and inert. The test card's cursor/run sequence reveals two passing cases and one failing duplicate-value case. Its live Run/Submit buttons restart the illustrative sequence; code and cases remain read-only. Running cases use the shared spinner; selected detail changes fade and shift 4px over 300ms. TestCases supplies the vertical scrollable case rail and independently scrollable right detail. Named inputs, expected output and actual output retain the application's ordering and field styling. Lobby settings use server-rendered MatchSettings with a supplied catalog, without sessions or backend requests. Familiar example problems include Two Sum, Subsets, Trapping Rain Water, Meeting Rooms II, Climbing Stairs and Number of Islands. Problem cards use restrained 2–4 degree tilts, clean stepped layering and an explicit example. The submission card layers two submission receipts along a timeline, with twenty verdict ticks per player and the first correct winner. Its 4.4-second sequence runs once and pauses offscreen or hidden. Mode, problem and replay controls are omitted. Reduced motion shows settled results immediately. App inputs and judging stay unchanged; demo results are illustrative.

Marketing depth tokens: illustration stroke mixes text at 35 percent with border; faint geometry uses border. Product shadow light: 0 2px 4px text at 4 percent, 0 24px 64px text at 10 percent; dark: 0 2px 4px black at 12 percent, 0 24px 64px black at 24 percent. Recessed backdrop uses surface/overlay tonal changes and a soft radial white highlight (4 percent dark, 60 percent light). No saturated glow. Feature gap 20px, illustration stage 280px, SVG viewBox 520×320. Mode graphics use 14–20px labels, 1px neutral strokes, 20 score ticks per contestant and one blue winner accent. Player silhouettes and code glyphs represent separate solutions; opponent source is never shown. Static example results are labeled through the graphic description. Hover lifts challenge layers by 4px over 180ms; reduced motion removes displacement.

Upcoming modes continue the two-column open illustration grid, each with a visible Coming soon badge beside its title. Tech Stacked shows a failed service and a replacement block rerouting traffic; Factions shows three distinct parties facing one another; Codebase Clash links an existing repository and issue to a file diff; Odyssey grows an object model and its lifecycle states over three labeled rounds. These are conceptual previews, with no playable controls, release dates or scoring promises. Badge uses existing overlay/border/secondary-text tokens, 6px corners and 12px type. Illustration labels remain 18px, code labels 14px, with mobile code labels increased to 18px.

Workspace navigation uses a generic menu button and profile icon/popover. Marketing uses expanded Practice/Create match links, collapsing into a hamburger when the header has less than 440px of usable width. Login occupies the right edge, disabled until authentication is implemented; theme switching lives in the footer. Marketing copy describes coding generally rather than positioning the product around a single language. Create match appears only outside match/invite screens. Practice discovery uses compact searchable rows with difficulty/topic filters and accessible title/difficulty sorting; no synthetic solved statuses. Homepage /, catalog /practice, problem /practice/{slug}, competitive workspace /match/{id}.

### Pixel brand mark

Use the supplied monochrome pixel artwork, cropped to its exact 25x24 alpha bounds. Preserve its pixels and transparent holes; scale with nearest-neighbor or crisp SVG paths. Visible brand links show only the pixel mark, inheriting text color through an SVG mask. Favicons switch all fallback formats between black/white with page theme. Platform icons use neutral square canvases, with dedicated maskable safe-area spacing.

### Marketing hero

Asymmetric split. Upright Barlow Condensed 800 headline reads Code. Clash. Conquer., with replayable crossed swords on Clash. A vertically offset match illustration explains the mechanics. One Create match CTA. Blue is reserved for actions and meaningful score progress.

| Hero token | Value |
| --- | --- |
| display | clamp(52px, 5.4vw, 80px) |
| mobile-display | clamp(44px, 9vw, 64px) |
| display-weight | 550 |
| display-leading | 1.06 |
| display-tracking | -0.06em |
| header-height | 100px; below 700px 80px |
| content-gap | clamp(32px, 4vw, 56px) |
| viewport-padding | clamp(32px, 5vw, 64px) |
| support-width | 36ch |
| scene-width | 440px |
| scene-offset | 88px |
| scene-radius | 16px |
| scene-shadow | marketing depth token |
| atmosphere | 12px Swiss dot grid; 2.25px neutral dots, top fade, slow opacity waves |
| entry-easing | cubic-bezier(0.16, 1, 0.3, 1) |
| entry-duration | 440ms |
| entry-stagger | 0/100/220/340ms, completes at 780ms |

The hero is a 440px-wide Climbing Stairs workspace. Show the title, difficulty, always-visible topics, short description and one sample input/output pair, without a Problem eyebrow, topic toggle, constraints or scrolling. PythonEditor types a six-line solution with variable timing, pauses, deletions and corrections. The one-shot sequence then shows Run, both contestants submitting, test counts and the first correct winner; no test-case browser appears in the hero. Run/Submit are illustrative controls. The sequence plays automatically, with no pause/play or replay control. Offscreen/hidden tabs suspend animation and reduced motion shows the final scene. The six-line code area reserves 164px so typing never changes hero height. Below 800px the editor moves beneath copy. Preserve 44px targets, theme contrast and no horizontal overflow.

Hero Swiss dots follow Ramp’s spring-grid treatment: 150px cursor repulsion, damped return and expanding click ripples. Canvas has no pointer capture; controls keep their native interactions. Offscreen/hidden tabs suspend drawing; reduced motion keeps a static grid.

Battle headline: uppercase Barlow Condensed 800, no italic or serif. Clash uses the existing 680ms sword animation on entry, hover and activation, with bounded pointer tilt. Reduced motion retains static swords and readable text.

Marketing surface lighting: paired light/shade tokens cast reflected light across card faces and overlapping shadows onto recessed layers. Keep foreground difficulty, topics, sample symbols and controls readable; fade peripheral/back-plane content. Hero input/output symbols are 14px and centered alongside adjacent example groups. Winners use success green. Buttons use the shared small radius, with no northeast arrows. The closer uses two perspective code planes illuminated from the center, fading into a floor grid; its emblem enters once and stays static under reduced motion. Footer includes copyright, a compact sitemap, and a theme switch synchronized with the navbar.

Coming soon Social/Adaptive cards use quarter-strength surface light, shallow 8px/20px shadows and gentle occlusion; no radial stage spotlight. Keep their data clear rather than dramatically lit.

Hero run status reserves 16px before the Run/Submit group; all-passed results use success green, running status remains secondary text.

Messy bento: game-mode row splits alternate 1.15:1, 1:1.2 and 1.3:1, producing T-junctions without four-way seams. Walkthrough columns share available width; each stack uses intrinsic heights. Container queries move cards onto additional rows before compression; standalone problem/submission cards use horizontal compositions until 650px.

Walkthrough stacks independently: match setup above submissions on the left; problem selection above editor/test on the right. Natural card heights close the empty space under problem selection. Below 661px available width, reflow to setup → problem → editor → submissions, retaining horizontal problem/submission compositions until 650px.

Responsive bento preserves paired columns through tablet widths. Between 661–989px available width, reduce chrome/padding and wrap lobby field labels; stack only below 661px. Mode pairings persist above 640px available width. Social/Adaptive preserve foreground/rear overlap on narrow screens.

Mode section has no outer rules; its internal dividers fade only at exposed ends, remaining solid where they join another divider, without masking content. Hero dots fade out at the bottom and the preview remains right-aligned when stacked. Problem labels omit code glyphs; Adaptive omits the sparkle. Wrong-answer receipts use error red only after judging resolves. Closing contrasts iterative and recursive memoized Climbing Stairs solutions.

Mode hover motion: a bounded mechanic-specific sequence per card (duel tick race, FFA lane fills, replica placement/rerouting, party convergence, code replacement, staged object growth). Shared spring easing, 160–900ms phases, no looping or card displacement. Fine-pointer hover only; reduced motion stays static. Divider-side padding is 28–48px; player counts sit beside titles.

Coming soon previews follow a layered wide composition: a clear rival/recommendation panel at left, larger dimmed leaderboard/performance surface behind, and right/bottom masks. Keep reflected light restrained; no glowing stage. Header copy aligns in two columns on desktop. Hover sequences explicitly show service failure before rerouting, failed → running → passing tests, and party signals converging on the arena. Footer spreads Play/Explore across a dedicated half-width grid; theme control belongs with copyright/All rights reserved. Primary hover retains a blue fill through a specific selector.

Editor/lobby walkthrough previews receive a subtle top spotlight, reflected rim and diffuse shadow. Primary hover styling covers both marketing and workspace button variants; neutral hover backgrounds never override blue fills.

Marketing button lift and return use 240ms hero easing. Disabled and aria-disabled controls remain stationary, with no hover fill or press transform. Reduced motion disables transitions.

Footer separates logo/navigation from a bottom utility row. Copyright sits left; the icon-only theme control sits right in a bordered 36px button. Small screens place brand above two navigation columns; the utility row retains left/right alignment.

Navbar logo is 36x35px within its 44px link; the theme control uses a 28x32px footprint with a 14px action gap. Browser ICO/PNG marks fill the raster width at every size, preserving aspect ratio and pixel edges.

## Editorial and admin authoring

Editorial controls sit below the problem statement, within its existing scroll area. Solutions are temporarily absent from practice. Complexity starts collapsed and uses the same eye/slash icon and control styling as Topics. Big-O and free-variable references in its descriptions render through the restricted LaTeX/KaTeX pipeline. Active match workspaces omit editorial controls. Disclosure and language controls keep 44px narrow-screen targets.

Admin authoring uses the existing 48px navigation, neutral surface, 24px heading and 15px body. A compact draft rail precedes grouped labeled fields; JSON editors are reserved for typed signatures/constraints/cases. Safe preview shares the public statement and editorial components. Save and publish remain explicit; publish confirms validation through inline errors. Existing radii, spacing and color tokens apply.

Shared navigation owns its 48px height independent of page layout; center 32–34px controls with visible top/bottom breathing room. Language, practice filters and workspace preferences share the Radix SelectField primitive with leading language logos, keyboard/typeahead, portal collision handling and token-based overlay/rows. Menus use 0 6px 20px neutral shadow at 8 percent in light mode, none in dark. Blue and semantic hues use saturated, in-gamut OKLCH accents; preserve at least 4.5:1 for body text and button labels.

Destructive buttons use `color-error-button`: light `oklch(0.55 0.22 27)`, dark inherits error; reserve the brighter semantic error for labels and indicators.

## Sign-in and discovery refresh

Sign-in follows the active workspace theme. Desktop uses a 48/52 showcase/form split with a hairline division and 400px form. The left side reuses the marketing problem-card stack over a restrained original deformed grid, in neutral/blue tones. Below 900px omit the showcase and center the form. Canvas motion pauses for reduced motion, hidden tabs and offscreen content. Use labeled inputs, visible errors, password visibility and capability-aware social/passkey controls; omit unsupported signup/reset/SSO actions. Guests receive a Sign in link instead of an initials avatar.

Auth keeps the logo at the top left, with a compact 12px Back link directly above the form heading and a Sign in/Create account mode switch. Registration asks only for email before verification, then reveals username/password setup and a blank optional Name field. Show Change email and a server-driven resend cooldown. Keep setup focused on credentials, omitting social controls after email proof. Omit unsupported reset/SSO actions.

Back preserves the referring app page and its query parameters; direct/external arrivals omit it. Password input and visibility control occupy adjacent boxes within one shared focus surface, so native password-field focus cannot obscure the eye.

Practice discovery retains compact Geist typography, shared navigation and select primitives. URL-driven search/filter/sort requests drive server results and bounded pagination; loading, error and empty states occupy the gallery's normal layout. Difficulty uses existing semantic tokens; topic controls remain keyboard-accessible. Do not invent completion statistics or user progress.

The practice table has alternating background/surface rows and no enclosing card. Whole-row pointer navigation complements the title link's keyboard behavior. Difficulty labels have no dot and add to selected difficulties; topic labels add to selected topics. Difficulty and topic triggers open compact popovers with wrapping multi-select chips. Triggers summarize selected choices; each popover provides Clear, without an Any option. Match any selection within each group, with difficulty and topic groups combined. Filter clicks never navigate to the problem.

Difficulty filter buttons use a semantic tint and inset edge on hover/focus, with a quick token-based transition and reduced-motion fallback. Hovering difficulty or topic controls suppresses the row highlight. Omit trailing row arrows; the question title remains the keyboard-accessible navigation link.

Show concise username rules as bullets immediately below signup/profile username fields. Profile contains editable optional name/username, a verified email-change action, and a password-reset email action. Recovery pages share auth branding/theme and expose resend cooldowns and clear success/error states.

Profile fields display read-only values with a pencil action aligned right. Open one field at a time; replace its value in place with an input and compact, labeled save/cancel icons while editing. Keep the resting value in layout so row dimensions and following sections never shift; float username guidance below the input and present operation feedback without adding flow content. Email verification and password-reset actions are likewise revealed by their field’s pencil. Cancel restores persisted values.

Settings use one shared dialog with independently scrollable category navigation on the left and settings content on the right. Group Profile and Security & login under Account; Appearance, Editor, Shortcuts and workspace Drafts under On this device. Profile retains photo/name/username pencil editing; email, password-reset and passkey actions belong to Security & login. The profile-menu Profile button opens the same dialog directly; the navigation shortcut appears only in question workspaces and opens Editor. Editor preferences and theme stay browser-local, using the existing storage keys. Preserve the two-pane layout on small screens with a compact rail, readable wrapping labels and 44px targets.

Profile photo editing uses the avatar itself as the upload trigger, with a small circular pencil at its top-right corner. Its tooltip includes accepted formats, 5 MB and 16 MP limits; the image stays circular and borderless. Password reset opens a bounded anchored confirmation with destination address, unchanged-password/session guidance, explicit send, sent confirmation and resend cooldown. Settings categories, edit/value layers, overlays, status feedback and disabled/loading states use short opacity/color transitions from one timing family. Outgoing edit controls become inert immediately and unmount after the fade; retain row geometry and disable motion for reduced-motion preferences.

Profile identity places a 128px circular avatar beside stacked Name/Username fields. At narrow widths (540px viewport and below), use a 96px avatar above the fields. Retain the top-right pencil, restrictions tooltip and fixed edit-row geometry.


Guest-hosting controls appear only for eligible accounts. Admission uses a compact lock icon beside Leave, independent of guest access; animate its shackle between open and closed, respecting reduced motion. Match completion uses a calm score summary and dismissible result dialog. Forfeit explains its actual multiplayer consequence with Keep playing focused first. Guest navigation always offers Sign in; completed guest participation loses its session. Browser-local intelligence is available without an account; hosted engines retain capability checks.

Eligible hosts control guest access through a person icon immediately left of the admission lock. Access defaults off: a short animated slash draws when disabled and retracts when enabled; reduced motion switches instantly. Creation uses the same icon in its heading. No guest allowance counters.

Match loading/recovery retains shared navigation. Center a bounded 440px state with a neutral 48px symbol, 24px heading and 14px explanation. Group reconnect and practice actions with 12px spacing; loading/retry states use restrained motion with a reduced-motion fallback.

## Application navigation

Never display a wordmark; use only the pixel logo mark throughout the application.

Keep a full-width 48px top bar with a single thin bottom stroke aligned with the desktop solution surface: three-line hamburger toggle (short final line) first, pixel logo mark alone immediately to its right. Profile remains at the far top right, immediately preceded by Create match (or the active-match return action), with workspace settings and contextual save state farther left. Neither branding nor profile moves when the sidebar expands. Account menus open below the avatar, respecting viewport bounds.

Above 900px, the same mounted grey preview rail widens from 48px to 15.5rem in place; its icons and toggle remain stationary and labels reveal. Do not slide a duplicate overlay over the rail. Below that breakpoint use the full-height modal drawer. Its own header uses an X close icon and aligns the close control and logo with the controls underneath. Keep the profile in the underlying top-right position. Darken the whole page, including the top bar, with a 40% black backdrop. Above 900px show a 48px icon-only peek with 44px click targets below the top bar; reserve that width on the app root, never the body (modal scroll lock resets body padding), so opening/closing the overlay never shifts content. Hide the peek entirely on smaller screens. No stored expansion preference. Start links 8px below the header, with no Navigate subtitle or reserved label space in either drawer or peek. Home, Practice and role-gated Question Editor belong to the drawer; Question Editor uses a square-pencil edit icon in both drawer and account menu. Match creation/return belongs beside the top-right profile. At 620px and below it becomes a 32px square with a 16px icon, no label padding/gap and a transparent 44px hit area. Preserve auth/match gating.

Desktop animates the existing rail width and label opacity; mobile animates the drawer transform. Both fade the backdrop with 240ms cubic-bezier(0.22, 1, 0.36, 1), matched entrance and exit. Keep root space reserved at 48px throughout desktop expansion, so content never shifts. Mobile Radix retains closing content until animation completes, traps focus and restores focus to the opener; desktop uses Escape and backdrop dismissal without replacing the rail. Escape, close control and backdrop dismiss it. Reduced motion disables the animations. Use Geist, neutral tokens and transparent navigation rows; selected links use blue text/icons and hover changes foreground only; omit sidebar edge rules, section dividers and selection strokes. Align all desktop navigation icons and the open/close control on the rail center at x=24px; use a 44px icon track with labels beside it. Narrow screens cap width at 82vw and retain 44px targets. Keep editor geometry and independent scroll areas intact.

Default profile pictures use only the first name letter (username fallback), `avatar-background: #666666` and `avatar-foreground: #ffffff` in both themes; text contrast 5.74:1. Keep actual uploaded photos.
