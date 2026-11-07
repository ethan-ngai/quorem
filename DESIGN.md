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
    controlHover: { light: "oklch(0.95 0.003 255)", dark: "oklch(0.25 0.008 255)" }
    controlSelected: { light: "oklch(0.94 0.004 255)", dark: "oklch(0.25 0.008 255)" }
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

## Required design contract

All agents must apply this contract to UI planning, implementation, refactors and reviews. Prioritize the editor. Carry confirmed preferences through iterations and handoffs; preserve behavior and presentation during representation changes. Write positive instructions; use negatives for clearer boundaries.

## Model the task

- Abstract schema fields into coherent user concepts and operations before choosing controls.
- Derive semantically valid choices from the model; scale compatibility across inputs and localize conflicts.
- Expose small, fixed choice sets through segments, radios or chips. Use dropdowns for longer/variable lists, including languages and comparison operators where appropriate.
- Use switches for binary settings, Add/Remove for optional content, and explicit names for meaningful modes.
- Distinguish viewing, editing, enabling submissions, publishing and deleting. Clarify consequential actions before execution.
- Choose defaults, placement and emphasis deliberately; each communicates intent.

## Hierarchy and disclosure

- Lead with the task and primary action. Keep labels factual; give each heading or instruction new information.
- Prefer descriptive icons with tooltips over prose. Match established icon meanings to the action or state.
- Retain useful action text, especially Add labels. Apply feedback to its context and balance brevity with clarity.
- Reveal secondary details, long selections and advanced options on demand. Show bulk controls with selection.
- Use compact, searchable rows and bounded scrolling for large collections; use bullets where prose benefits.
- Label availability and illustrative data truthfully. Report measured progress; expose internal details when useful for decisions or recovery.

## Layout and typography

- Compose the whole page. Align related labels, icons, controls and content through shared insets; give each gap a purpose.
- Group flat task surfaces with spacing and restrained separators. Use backgrounds, borders and elevation to communicate structure; retain meaningful grouping when simplifying.
- Establish compact controls, readable line lengths and consistent heading/body/metadata hierarchy across views.
- Use shared control colors for hover, selection and open triggers. Fade hover fills in place and keep selected radio choices stable on hover.
- Use Geist for UI/prose; JetBrains Mono for code, parameters, identifiers, machine values and units. Disable code ligatures.
- Render math with proper symbols and spacing. Keep literal brackets/punctuation neutral while values retain syntax colors.
- Use white light-mode reading/editor surfaces, neutral controls, blue actions/focus and semantic colors with text/icons. Maintain contrast in both themes.
- Preserve source, undo, selection, focus and scroll through appearance/layout changes. Reserve asynchronous status space while keeping related controls adjacent.

## Shared ownership

- Inspect analogous consumers first. Fix the lowest shared owner: React primitives in `apps/web/src/ui`, cross-app foundations in `packages/ui`.
- Primitives own typography, padding, focus, disabled states, layering and motion. Features own composition, dimensions and domain policy. Extend primitives for recurring needs.
- Share rendering/controls across practice, competition, interviews, authoring and previews. Previews own scale/composition and work independently of page ancestors.
- Preserve authorization, private-test boundaries and admitted input/result snapshots.
- Share table surfaces, sorting and pagination. Filter/order authorized results before paging; reset pages on filter/sort/page-size changes. Keep embedded SQL/document tables compact.

Tokens: `packages/ui/src/theme.css`; JavaScript layout/motion values: `packages/ui/src/tokens.ts`. Change the owner once. Keep feature details in `docs/implementation`; preserve the [marketing brand contract](docs/implementation/marketing-brand.md).

## State and motion

- Design empty, loading, disabled, pending, read-only, error, recovery and large-data states alongside success. Keep actions usable at narrow widths.
- Animate language/content switches, disclosures, overlays, selections and row changes through shared owners. Use short, reversible transitions and shared motion tokens.
- Apply state immediately. Retain old asynchronous content until its replacement is ready; transition content and dimensions smoothly.
- Respect reduced motion. Keep editing focused; pause decorative marketing motion offscreen or in hidden tabs.
- Use the shared `ScrollCue` for overflow hints in scrollable panes. Match its axis to the scroll direction.
- Support keyboard focus, accessible names and icon tooltips. Overlays own focus entry/restoration, trapping, dismissal and collision handling, including disappearing triggers.
- Dismiss hover tooltips when the pointer leaves the trigger. Empty hints show no tooltip.
- Preserve disabled/pending geometry, prevent duplicate actions and use shared destructive-action treatment.

## Feedback and recovery

- Use concise toasts for completed actions and transient failures. Include nonzero outcome counts; disclose details through named actions. Keep routine successful autosave silent.
- Keep active progress, blocking errors and next-step instructions beside the operation. Deduplicate notifications and retain recovery after toast expiry.
- Explain cause, affected item and correction. Mark every participating conflict origin; include page-level errors when blocked. Clear diagnostics by origin.
- Keep `PersistentNotice` mounted in a stable status slot, or wrap content with `NoticeRegion`. Shared popovers hold details/recovery; closing details preserves the issue.

## Workspace contracts

- Problem left, editor right, results below; support pointer/keyboard resizing. Keep node diagrams to the right of the complete input/output stack; shrink previews to fit narrow panels. Show verdicts and diagnostics above case values only for the selected case's admitted result; collapse absent feedback completely and keep full diagnostics scrollable inline. Case selectors use checks/Xs; verdict headings use error-specific symbols. Empty structures use `∅`, variable name and tooltip.
- Expand desktop navigation in place; use a mobile drawer and retain the logo through transitions.
- Start with system theme; persist explicit choices and separate light/dark editor schemes. Default to JetBrains Light/Dark.
- Use identity colors for participant avatars, remote carets and selections; photo rings and initial backgrounds. Keep the local caret in its editor scheme.

## Completion gate

Before calling UI work complete:

1. Inspect the served page and affected consumers for hierarchy, spacing, typography and coherence. Verify motion in use.
2. Use live Vite/HMR from the intended checkout; report its exact URL. Check desktop/narrow layouts, both themes, keyboard/reduced motion and relevant states/scale extremes.
3. Exercise hover, focus, overlays, failure and recovery. Combine browser evidence with appropriate tests; report unchecked material states.
4. Remove duplicated defaults, styles, behavior and obsolete paths. Complete shared fixes before declaring consumers consistent.
