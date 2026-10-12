# Marketing homepage

Issues #16 and #30. Static Astro app in `apps/marketing`; React owns `/practice`, `/practice/{problem}` and `/match/{id}`.

- Lead with private competitive coding: Showdown, Free-for-all, shared challenges, invitations and host conduct policies. Editor capabilities are supporting functionality, not the marketing pitch.
- [Linear](https://linear.app/) informs original isometric match diagrams; [Supabase](https://supabase.com/) informs asymmetric product surfaces; [Ramp](https://ramp.com/) and [Raycast](https://www.raycast.com/) inform spacing and product depth. Geist headings describe actual behavior. Two open mode illustrations lead into layered challenge cards, actual lobby captures, a shared editor island and a submission illustration. Paired neutral/blue tokens and marketing-only shadow/radius tokens live in `DESIGN.md`.
- Expanded Practice/Create match navigation collapses below 440px of available header width. Login stays disabled until #14; theme toggle lives in the footer.
- Shared `@quorem/ui/theme.css`, Geist and `quorem.theme.v1`. System theme initially; explicit toggle persists across marketing/workspace.
- Product captures live in `apps/web/public/promo`: desktop `lobby-{light,dark}.png`, portrait `lobby-mobile-{light,dark}.png`. Native picture sources switch at 700px; width fits the container, height follows the source aspect ratio. No fixed image minimum widths or arbitrary crops. Captures exclude invitation tokens.
- Hero entry finishes in 780ms using transform/opacity; an 8.8-second pausable example types code and lets the opponent win, pausing offscreen/when hidden. Reduced motion shows final code/scores; 560ms section reveals and 120–180ms interaction feedback. Reduced motion removes transforms. Essential content remains visible without JavaScript.
- `EditorPreview.tsx` imports the web app's `PythonEditor` directly. `client:visible` defers React/CodeMirror until the section enters view; server-rendered code remains visible before hydration and without JavaScript. Edits/reset are in-memory only, with no API, session or draft writes. Theme changes reconfigure the existing editor. Lobby captures stay static to avoid mounting session-dependent match UI.
- `vp -C apps/marketing run build` compiles the static page. Development builds Astro before services start; Vite serves it at the shared origin. Rebuild after marketing edits. `vp run build` assembles the homepage and React entry into one artifact.

Verified production at 1440×900 and 390×844 in light/dark: no page overflow or browser errors, editor editing/reset, lazy hydration, theme synchronization and responsive image sources. `vp check --fix` and `vp run build` passed.

## Brand assets

- `logo-pixel.png`: exact 25x24 transparent-border crop of supplied artwork; all 287 opaque pixels preserved. SVG encodes original pixel runs.
- Explicit light/dark SVG, PNG and ICO favicons follow page theme via shared `favicon-theme.js` (including manual theme overrides); adaptive SVG remains the no-JavaScript default. Multi-size ICO, 16/32/48/96 PNGs, Apple touch icon, 192/512 app icons, dedicated maskable icon, Safari pinned-tab mask and Windows tile. Platform square/safe-area canvases add space; source logo has none. Nearest-neighbor scaling preserves pixel edges.
- Both HTML entries reference icons/manifest. Marketing adds a 1200x630 social card. Set `QUOREM_SITE_URL` to deployed origin for absolute Open Graph image URLs; local builds use a same-origin path.
- Visible branding uses the logo alone in marketing header/footer, workspace navigation and social preview. SVG masks inherit theme text color.

- Hero background follows [Ramp](https://ramp.com/) Swiss dots: 12px grid, soft opacity waves, 150px cursor repulsion with spring return, and click ripples. A local Canvas 2D implementation caps DPR at 2, runs idle waves at 30fps, suspends offscreen/hidden, and renders a static reduced-motion fallback. Links and controls do not trigger the field.
