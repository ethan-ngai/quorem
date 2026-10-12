# Marketing homepage

Issues #16 and #30. Static Astro app in `apps/marketing`; React owns `/practice`, `/practice/{problem}` and `/match/{id}`.

- Lead with private competitive coding: Showdown, Free-for-all, shared challenges, invitations and host conduct policies. Editor capabilities are supporting functionality, not the marketing pitch.
- [Raycast's Build the perfect tools section](https://www.raycast.com/) informs the ruled asymmetric grid, sparse blue diagrams and large restrained type. Preserve portfolio/CUXR spacing and Quorem's existing neutral/blue theme. No invented adoption metrics or testimonials.
- Expanded Practice/Create match navigation collapses below 440px of available header width. Login stays disabled until #14; theme toggle lives in the footer.
- Shared `@quorem/ui/theme.css`, Geist and `quorem.theme.v1`. System theme initially; explicit toggle persists across marketing/workspace.
- Product captures live in `apps/web/public/promo`: desktop `lobby-{light,dark}.png`, portrait `lobby-mobile-{light,dark}.png`. Native picture sources switch at 700px; width fits the container, height follows the source aspect ratio. No fixed image minimum widths or arbitrary crops. Captures exclude invitation tokens.
- 560ms entry/reveal and 120–180ms interaction feedback. Reduced motion removes transforms. Essential content remains visible without JavaScript.
- `vp -C apps/marketing run build` compiles the static page. Development builds Astro before services start; Vite serves it at the shared origin. Rebuild after marketing edits. `vp run build` assembles the homepage and React entry into one artifact.

Verified desktop and 390px mobile, both themes: image source/dimensions, no horizontal overflow, responsive navigation and visible product content.

## Brand assets

- `logo-pixel.png`: exact 25x24 transparent-border crop of supplied artwork; all 287 opaque pixels preserved. SVG encodes original pixel runs.
- Adaptive SVG favicon, multi-size ICO, 16/32/48/96 PNGs, Apple touch icon, 192/512 app icons, dedicated maskable icon, Safari pinned-tab mask and Windows tile. Platform square/safe-area canvases add space; source logo has none. Nearest-neighbor scaling preserves pixel edges.
- Both HTML entries reference icons/manifest. Marketing adds a 1200x630 social card. Set `QUOREM_SITE_URL` to deployed origin for absolute Open Graph image URLs; local builds use a same-origin path.
