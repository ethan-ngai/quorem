---
name: Quorem Workspace
description: "Editor-first, compact and quiet. Shared primitives enforce consistent behavior and appearance."
colors:
  primary: { light: "oklch(0.54 0.22 260)", dark: "oklch(0.68 0.165 260)" }
  brand:
    secondary: { light: "oklch(0.94 0.04 260)", dark: "oklch(0.28 0.065 260)" }
    accent: { light: "oklch(0.50 0.21 260)", dark: "oklch(0.72 0.14 260)" }
    onPrimary: { light: "oklch(1 0 0)", dark: "oklch(0.15 0.006 255)" }
  neutral:
    inlineCode: { light: "oklch(0.965 0.003 255)", dark: "oklch(0.27 0.006 255)" }
    background: { light: "oklch(1 0 0)", dark: "oklch(0.18 0.004 255)" }
    surface: { light: "oklch(0.98 0.002 255)", dark: "oklch(0.205 0.005 255)" }
    overlay: { light: "oklch(0.98 0.002 255)", dark: "oklch(0.25 0.008 255)" }
    field: { light: "oklch(1 0 0)", dark: "oklch(0.205 0.005 255)" }
    border: { light: "oklch(0.925 0.003 255)", dark: "oklch(0.28 0.006 255)" }
    text:
      primary: { light: "oklch(0.24 0.006 255)", dark: "oklch(0.91 0.004 255)" }
      secondary: { light: "oklch(0.45 0.008 255)", dark: "oklch(0.73 0.008 255)" }
      disabled: { light: "oklch(0.59 0.005 255)", dark: "oklch(0.52 0.006 255)" }
  semantic:
    info: { light: "oklch(0.52 0.18 260)", dark: "oklch(0.70 0.14 260)" }
    success: { light: "oklch(0.58 0.175 145)", dark: "oklch(0.73 0.16 150)" }
    warning: { light: "oklch(0.816894 0.136542 74.39175)", dark: "oklch(0.78 0.15 75)" }
    error: { light: "oklch(0.60 0.23 27)", dark: "oklch(0.70 0.19 25)" }
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

## Product values

The editor is the focal point. Optimize for reading, writing, testing and recovering code. Compact controls and quiet neutral surfaces leave room for the task. Marketing can explain competition with richer illustrations; application screens stay focused.

Use clear hierarchy and factual labels. Show information that helps someone decide or act. Omit ornamental eyebrows, repeated headings, routine connection/autosave chatter, internal IDs and fabricated progress. Present unavailable capabilities honestly.

Preserve approved product language, branding and interactions. Quorem uses its supplied logo for navigation. Marketing navigation centers its public links, separating same-page exploration from Practice and Create match with a divider and brighter, medium-weight app links; theme, Sign in and Get started sit on the right. On-page links collapse into the menu before Practice and Create match. Get started opens the existing registration flow. The marketing footer pairs the logo with the same wordmark artwork as the hero, sized for a compact horizontal lockup. The marketing hero uses Russo One outlines: squared bowls, a blocky m, a full-width lower e terminal and a custom stepped q tail drawn from the mark. Keep the wordmark compact, capped at 480px. Marketing uses “Compete beyond the algorithm” below the wordmark in upright regular Silkscreen, with wide blocky pixel letterforms, kept on one line with blue emphasis on “beyond”. Keep the hero copy to the wordmark, slogan and CTA; omit the description. Preserve the interactive dots. Treat references as evidence: inspect the actual app before claiming a match.

## Shared foundations

`packages/ui/src/theme.css` implements the palette, typography, spacing, radii, layering and motion tokens above. `packages/ui/src/tokens.ts` provides layout values needed by JavaScript. Editor scheme palettes live beside the editor. Change the owning token once; keep this document about intent rather than duplicating implementation tables.

Use Geist for interface/prose and JetBrains Mono for code and machine values. Keep literal operators readable; disable editor ligatures. Large light-mode reading and editor surfaces are white. Reserve closely spaced off-whites for compact controls and overlays, with darker neutrals limited to small elements or strong emphasis. Blue identifies actions and focus. Semantic colors accompany text or icons. Maintain readable contrast in light and dark themes. System theme is the initial preference; explicit choices persist. Editor schemes follow global appearance using separately saved light and dark choices. Default to the new JetBrains Light and Dark palettes; named alternatives remain scoped to the editor.

Separate content through spacing, thin rules and tonal changes. Workspace panes stay flat, without nested cards, ornamental gradients, glass or decorative shadows. Small control radii and restrained overlay elevation follow shared tokens.

## Primitive ownership

Fix shared behavior and appearance at the lowest reusable layer. React primitives live in `apps/web/src/ui`; cross-app CSS foundations live in `packages/ui`. Features own content, dimensions and domain policy. A feature must not supply missing primitive typography, padding, focus, disabled behavior, portal layering or motion through ancestor selectors.

Reuse controls for buttons, selects, switches, tabs, tooltips, popovers, dialogs, sharing, loading and recovery. Extend a primitive for a recurring need; avoid feature-specific copies and compatibility re-exports. Compose primitives without erasing their accessible semantics. Keep native text editing and disclosure controls where appropriate.

Application and marketing product previews consume the same components and styles. Preview containers own scale and composition, not substitute button/editor/test styling. A preview must work without an application page ancestor. Label illustrative data and keep previews separate from real judging, sessions and persistence.

## Workspace and interaction

Problem left, solution right, results below the editor; panes resize with pointer and keyboard. Keep source, undo, selection, focus and scroll stable through theme, pane and result changes. Controls align through shared insets. Narrow layouts preserve usable actions and content access without horizontal page overflow.

The fixed application header casts a subtle shadow to separate it from scrolling content. The desktop navigation rail expands in place. Mobile navigation uses a dismissible drawer. Keep the logo mounted through navigation transitions. Align control icons and text; preserve space when optional information hides or asynchronous state changes.

Share typed input/output rendering, case navigation and execution controls across practice, competition, interviews and authoring. Render results against their admitted source/input snapshot. Authorization, hidden tests and domain-specific rules remain enforced by the server.

Transient failures and room events use shared toasts; room alerts retain accessible history. Field validation, execution diagnostics and blocking failures stay beside their recovery controls. Deduplicate reconnect/repeated background notifications. Keep recovery available after a toast expires. Routine successful autosave stays silent; save failures remain recoverable.

## Accessibility and motion

All working controls support keyboard focus and an accessible name; icon-only controls have shared tooltips. Overlays own focus trapping/restoration, dismissal, collision handling and layering. Disabled and pending controls prevent duplicate actions and retain stable geometry. Destructive actions use shared semantic treatment.

Collaboration colors follow user identity across participant avatars, remote carets and selections. Photos carry a colored ring; initials use the color as their background. The local caret retains its editor scheme.

Motion explains interaction or state changes. Reuse short, reversible transitions; avoid ambient movement while coding. Respect reduced motion. Suspend decorative marketing animation offscreen and in hidden tabs. Loading and status changes must not move surrounding content.

## Verification

Use live Vite/HMR from the intended checkout. Check the served UI at desktop and narrow widths, both themes, keyboard navigation and reduced motion. Exercise real hover, focus, disabled, pending, empty, error and recovery states. Inspect spacing and portal stacking in the browser; passing tests alone does not prove visual correctness.

Keep feature behavior, dimensions and verification details beside the owning implementation or in `docs/implementation`. Add a rule here only when it expresses a durable product value or a shared design contract.
