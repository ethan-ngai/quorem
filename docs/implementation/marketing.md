# Marketing homepage

Issues #16 and #30. Static Astro app in `apps/marketing`; React owns `/practice`, `/practice/{problem}` and `/match/{id}`.

- Shared `@quorem/ui/theme.css` colors, Geist and `quorem.theme.v1` preference. System theme initially; explicit toggle persists across marketing/workspace.
- Asymmetric typographic hero, actual paired product captures, flowing feature bento and open match comparison. Portfolio `/mac` supplies spanning geometry; CUXR supplies open layout, scale and factual copy. No fabricated metrics, testimonials or pricing.
- CSS handles 560ms spring entry/16px scroll reveals, 120–180ms interaction feedback; IntersectionObserver reveals once. Reduced motion removes displacement. Essential content remains visible without JavaScript.
- Shared assets live in `apps/web/public/promo`: `editor-{light,dark}.png` and `lobby-{light,dark}.png`. Astro reads this public directory and emits collision-free `/_marketing/` compiled assets. Captures show local fixtures; cloud/public launch claims are omitted.
- `vp -C apps/marketing run build` compiles one static page. Development builds Astro before starting services; Vite serves its static homepage and compiled assets at the shared origin. Rebuild marketing with `vp -C apps/marketing run build` after source edits. Production assembly preserves React's entry separately and installs Astro's index at `/`.
