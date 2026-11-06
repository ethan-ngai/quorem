# Tables

`apps/web/src/ui/Table.tsx` owns list-table semantics, row click isolation and replacement motion. `table.css` owns shared appearance. Features own columns, content, widths and domain actions. Practice, authoring and interviews consume these directly; no Practice table wrapper remains.

`useServerTable` controls TanStack Table in manual sorting/pagination mode. It never reorders or slices server rows. `TableControls` owns sortable headers, accessible previous/next actions, counts and the 10/20/50/100 rows-per-page selector. Changing size or sort resets to page 1; totals clamp stale pages after deletion/filter changes. React Query owns requests and cache isolation.

Practice and authoring retain page, size and sort in URL state; interview and picker state is local. Defaults: Practice 20, authoring/interviews 50, picker 100. Authoring defaults to newest-edited drafts and alphabetical publications; interviews default to most recently updated. Equal sort keys use stable identifiers. Draft Load more becomes numbered pages; bulk selection applies to the visible page and clears when URL scope changes.

The public catalog, authoring and interview APIs validate page/limit bounds through `application/list-query.ts`. PostgreSQL owns filtering, sorting and pagination. Authoring replies include items, total, page, limit and unfiltered facets. Draft readiness remains publication-validator policy: when requested, bounded batches are validated before counting/selecting the requested page. Other draft queries validate only the returned page. Interview replies include items, total, page, limit and a server-wide authorized active-host count, so hosting capacity never depends on the visible page. Private interview payloads remain absent.

Authoring cursor pagination and the interview array response were replaced. Deploy API and web together. SQL case editors/previews and Markdown tables remain document surfaces with their own compact behavior, without list pagination.
