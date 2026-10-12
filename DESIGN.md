---
name: Quorem Workspace
description: "A compact coding workspace led by Linear: calm tonal surfaces, soft edges, direct problem hierarchy, and restrained blue actions."
colors:
  primary: { light: "oklch(0.48 0.15 255)", dark: "oklch(0.72 0.12 255)" }
  brand:
    primary: { light: "oklch(0.48 0.15 255)", dark: "oklch(0.72 0.12 255)" }
    secondary: { light: "oklch(0.94 0.025 255)", dark: "oklch(0.26 0.035 255)" }
    accent: { light: "oklch(0.43 0.15 255)", dark: "oklch(0.77 0.11 255)" }
    onPrimary: { light: "oklch(1 0 0)", dark: "oklch(0.15 0.006 255)" }
  neutral:
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
    info: { light: "oklch(0.44 0.008 255)", dark: "oklch(0.75 0.008 255)" }
    success: { light: "oklch(0.43 0.10 155)", dark: "oklch(0.75 0.10 155)" }
    warning: { light: "oklch(0.43 0.10 75)", dark: "oklch(0.75 0.10 75)" }
    error: { light: "oklch(0.43 0.10 25)", dark: "oklch(0.75 0.10 25)" }
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

Linear is the primary application reference: one compact 48px navigation row, nearly uniform neutral surfaces, subtle edges, 6-10px radii, and 14px interface text. Coding sites inform reading order: 24px title, difficulty, optional Topics, immediate prose, one Examples heading without visible numbering, named input/output fields, then ordinary constraints. Example code fields use text-fitting background tone against the surface; each pair reserves space for its optional explanation. Topics use an eye show/hide control beside difficulty and title-cased labels with a subtle neutral background and small corners in reserved space between difficulty and description; hiding keeps its layout space. Preserve the portfolio/CUXR font and tonal restraint without their editorial framing. Remove ornamental eyebrows, repeated pane titles, version numbers, file encodings, normal connection chatter, and visible source hashes. Keep actionable errors and recovery. Run and Submit occupy the bottom of the shared solution surface, right aligned. On narrow screens that action row remains visible in every workspace pane. Samples and Custom cases are the two case collections; execution results attach to their admitted case snapshot rather than a separate Test result tab. Following [HackerRank sample test cases](https://candidatesupport.hackerrank.com/articles/1258064241-sample-test-cases), individual cases occupy a left rail with independent scrolling and a subtle vertical divider. Selected rows use a quiet neutral fill and medium weight. The right detail scrolls independently; a Run verdict spans both columns above them. Public examples show named inputs and expected output. Custom cases have one labeled control per signature argument, optional expected output, and add/remove controls; their wire representation remains an ordered typed args array. Typed preset controls expose fixed collection brackets, numeric expression inputs, plain text and boolean choices. Nodes retain codec-defined level/order semantics; nested/custom controls come from registered presets. Show validation errors, omit routine format hints. Optional expected output is added or removed with a quiet action, preserving its value when removed. Run result details display only authoritative public output and expected values, never current editable inputs. Submit displays verdict, score and safe errors only. The editor and results share one rounded work surface; the statement is the second work area. No nested card shells, gradients, glass, or decorative motion.

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
| narrow-touch-target | 44px |
| case-rail-width | clamp(100px, 16%, 140px) |
| narrow-case-rail-width | 104px |

Desktop: problem left, editor right, results below editor; no marketing width cap on the workspace. Initial split is 40/60 and remains user-resizable. Results resize vertically. Support keyboard splitters with named controls and size announcements. Below the breakpoint, place problem/editor/results in accessible tabs or a single-column flow; choose the precise narrow-screen interaction during implementation review. Preserve source/scroll/focus on switching. Use tokens for gutters and spacing; measure rather than assume pane minima fit every device.

## Elevation & Depth

Separate panes with thin rules and surface changes. Light-theme popovers/modals may use elevation tokens; dark-theme overlays use borders and tonal separation. Avoid decorative shadows on workspace panes.

## Shapes & Corners

Work areas use a 10px outer radius; buttons/fields use 6px and overlays use 8px. Reserve full rounding for avatars/status markers. Avoid nested card shells.

## Animation

Theme-independent motion tokens: `motion-fast`: 120ms; `motion-standard`: 180ms; `motion-easing`: cubic-bezier(0.2, 0, 0, 1). Map them to shared CSS custom properties.

Brief color/opacity/transform feedback clarifies hover, selection, saving, and popovers. No ambient animation while coding. Reduced motion removes spatial transitions. Loading/status animation must not move code or result geometry.

## Components

- Buttons: Submit uses primary/onPrimary; Run uses neutral surface/border. Busy state names the existing job rather than silently accepting another.
- Fields: field background, readable text, visible focus; validation includes explanatory text.
- Editor: stable cursor/undo; color scheme changes reconfigure visual extensions in place. Completion, brackets and selection use editor-scoped palette colors; diagnostics include accessible explanations.
- Results: semantic icon/text, source snapshot association retained in data, bounded output, stable space for status transitions.
- Links: visibly identifiable and keyboard-focusable; use brand accent for navigation links.
- Status: quiet save indicators; persistent actionable failure messages. Toasts never hold the only recovery action.

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

Settings use a centered Radix Dialog: 700px maximum width, 460px bounded height, a 160px independently scrollable section rail, and scrollable detail pane. A subtle dark backdrop fades with the modal; 180ms opening and 140ms closing use opacity/scale, with reduced-motion support. Use Radix Select for choices and Switch for booleans. Appearance, Editor, Shortcuts, Drafts, and Local account retain existing persistence. Shortcut tiles use interface type and symbolic key caps (⌘, ⇧, ↵), retaining accessible key names from the same definitions used by TanStack Hotkeys; shortcuts are always enabled, with workspace actions paused while settings is open.

Competitive screens reuse the workspace scale: 48px navigation, 24px lobby heading, players side by side in a compact row divided by subtle rules, and readiness actions visible without scrolling at typical laptop/mobile heights. Creation uses an animated centered Radix Dialog; difficulty uses mutually exclusive segmented buttons and duration/account use Radix Select. Keep factual copy, interface typography for status, monospace only for machine values, and icon tooltips for copy/leave/forfeit. During play, a 48px score-and-clock bar replaces the oversized ledger. Hide normal connection chatter; retain reconnect feedback. Browser drafts replace server autosave; concurrent windows keep independent live buffers, with the latest browser save used on reload.

Lobby headings name the game mode without instructional subtitles. Settings apply immediately and reset readiness through the server. Readiness uses tooltip-labeled muted clock/green circle-check icons; leave actions are red. Copy feedback morphs to a green check for two seconds, respecting reduced motion.

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
