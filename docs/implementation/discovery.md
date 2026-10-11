# Discovery and navigation

Issue #30; depends on #29. Marketing also implements #16.

## Behavior

- `/` serves static Astro marketing. `/practice` lists public questions; `/practice/{slug}` opens a workspace; `/match/{id}` opens a competitive match. API routes stay unchanged.
- Navigation menu links Home and Practice. Profile popover contains the local development identity, theme and workspace preferences where available. Create match is hidden on match/invite routes, including loading and failure states.
- Marketing's Create match link opens creation on the catalog, consuming its query once. Closing/reloading does not reopen it.
- Catalog searches title, slug and topics; filters by difficulty/topic; sorts by title or difficulty. No unverified solved status. Mobile shows topics beneath each question.
- Marketing uses paired screenshots of the actual local editor/lobby. Capture excludes invitation tokens; both modes use identical fixture content. No AWS/public authentication claims.

## Validation

- `make check`: formatting/types/lint, contract checks, frontend/language tests and Go tests/vet.
- Production assembler and browser verification of homepage/catalog routes, loaded images, profile/settings, creation intent, search/empty state and mobile overflow.

## Serving

- `make dev` builds marketing before startup. Rebuild marketing after edits with `vp -C apps/marketing run build`.
- `vp run build` assembles `apps/web/dist`: Astro `index.html`, React `app.html`, distinct assets. Preview middleware applies production rewrites.
- Static deployment must preserve asset paths and rewrite `/practice`, `/practice/*`, `/match/*`, `/invite/*` to `app.html`. Cloud deployment remains a separate milestone.
