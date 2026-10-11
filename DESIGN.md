---
name: Quorem Workspace
description: "An open coding workspace informed by the portfolio and CUXR: paper and graphite, editorial Geist typography, ruled metadata, and restrained blue actions."
colors:
  primary: { light: "oklch(0.48 0.15 255)", dark: "oklch(0.72 0.12 255)" }
  brand:
    secondary: { light: "oklch(0.94 0.025 255)", dark: "oklch(0.26 0.035 255)" }
    accent: { light: "oklch(0.43 0.15 255)", dark: "oklch(0.77 0.11 255)" }
    onPrimary: { light: "oklch(1 0 0)", dark: "oklch(0.15 0.006 255)" }
  neutral:
    background: { light: "oklch(0.97 0.006 85)", dark: "oklch(0.18 0.004 255)" }
    surface: { light: "oklch(0.98 0.004 85)", dark: "oklch(0.205 0.005 255)" }
    overlay: { light: "oklch(0.95 0.004 255)", dark: "oklch(0.25 0.008 255)" }
    field: { light: "oklch(1 0 0)", dark: "oklch(0.195 0.004 255)" }
    border: { light: "oklch(0.81 0.006 255)", dark: "oklch(0.36 0.01 255)" }
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
  h1: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "32px", fontWeight: 550, lineHeight: 1.2, letterSpacing: "-0.025em" }
  h2: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "24px", fontWeight: 550, lineHeight: 1.25, letterSpacing: "-0.02em" }
  h3: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "19px", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" }
  body: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
  label: { fontFamily: "Geist Sans, Arial, sans-serif", fontSize: "12px", fontWeight: 500, lineHeight: 1.5 }
  monospace: { fontFamily: "JetBrains Mono, Consolas, monospace", fontSize: "15px", fontWeight: 400, lineHeight: 1.5 }
rounded: { sm: "4px", md: "6px", lg: "8px", full: "9999px" }
spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px", xxl: "64px" }
elevation:
  sm: { light: "0 2px 8px oklch(0.2 0 0 / 0.06)", dark: "none" }
  md: { light: "0 8px 24px oklch(0.2 0 0 / 0.08)", dark: "none" }
  lg: { light: "0 16px 48px oklch(0.2 0 0 / 0.10)", dark: "none" }
---

## Overview

Reference translation: preserve the portfolio's Paper/Carbon contrast, precise mono annotations and open ruled indices; use CUXR's Geist hierarchy and purposeful spacing. Scale these to a working IDE. No landing-page headings, card grids, ambient animation, gradients, glass, or decorative registration effects. Statement headings use 32px tightly tracked medium weight; reading copy is 15px with 1.7 line-height. Tags are inline metadata. Editor settings, history, recovery and local identity live in grouped popovers. A dedicated workspace action bar owns Run and Submit. Match status forms a compact ledger above the panes.

System theme is the initial preference; explicit light/dark override persists. The editor remains the focal point. These initial tokens translate confirmed direction; contrast, syntax readability, layout dimensions, and font rendering require actual browser validation before implementation acceptance.

## Colors

Neutrals occupy most of the workspace. Blue communicates selected controls, focus, and the primary action. Success/warning/error colors communicate verdicts alongside text/icons, never alone. Use field for editor/input backgrounds, surface for panes, overlay for popovers, border for rules. Use editor colors only for syntax/selection, not decoration. Focus uses an accent outline with offset, not a border-only color shift.

## Typography

Geist Sans carries interface and problem prose; JetBrains Mono carries code, inputs, outputs, and machine values. The UI scale approximates recursive multiplication of 12px by sqrt(phi). Compact labels never replace readable body text. Keep editor text configurable without changing interface scale. Self-host fonts with fallbacks. Headings remain left-aligned.

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
| control-height | 36px |
| narrow-touch-target | 44px |

Desktop: problem left, editor right, results below editor; no marketing width cap on the workspace. Initial split is 40/60 and remains user-resizable. Results resize vertically. Support keyboard splitters with named controls and size announcements. Below the breakpoint, place problem/editor/results in accessible tabs or a single-column flow; choose the precise narrow-screen interaction during implementation review. Preserve source/scroll/focus on switching. Use tokens for gutters and spacing; measure rather than assume pane minima fit every device.

## Elevation & Depth

Separate panes with thin rules and surface changes. Light-theme popovers/modals may use elevation tokens; dark-theme overlays use borders and tonal separation. Avoid decorative shadows on workspace panes.

## Shapes & Corners

Workspace panes remain rectangular; small radii belong to buttons/fields, larger radii to overlays. Reserve full rounding for avatars/status markers. Avoid nested card shells.

## Animation

Theme-independent motion tokens: `motion-fast`: 120ms; `motion-standard`: 180ms; `motion-easing`: cubic-bezier(0.2, 0, 0, 1). Map them to shared CSS custom properties.

Brief color/opacity/transform feedback clarifies hover, selection, saving, and popovers. No ambient animation while coding. Reduced motion removes spatial transitions. Loading/status animation must not move code or result geometry.

## Components

- Buttons: Submit uses primary/onPrimary; Run uses neutral surface/border. Busy state names the existing job rather than silently accepting another.
- Fields: field background, readable text, visible focus; validation includes explanatory text.
- Editor: stable cursor/undo, completion list and hover docs use overlay tokens; diagnostics include accessible explanations.
- Results: semantic icon/text, source snapshot identity, bounded output, stable space for status transitions.
- Links: visibly identifiable and keyboard-focusable; use brand accent for navigation links.
- Status: quiet save indicators; persistent actionable failure messages. Toasts never hold the only recovery action.

## Rules

Use shared CSS custom properties and inherited typography. Match all colors to theme tokens. Preserve keyboard access, WCAG AA contrast, readable zoom, reduced motion, and sensible narrow-screen touch targets. Verify computed contrast in both themes, including syntax and overlays. Keep factual copy and functional labels. Introduce token changes in this document before propagating them into components.
