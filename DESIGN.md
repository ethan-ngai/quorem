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

Lobby headings name the game mode without instructional subtitles. Settings apply immediately and reset readiness through the server. Readiness uses tooltip-labeled circle-minus/green circle-check icons; leave actions are red. Copy feedback morphs to a green check for two seconds, respecting reduced motion.
