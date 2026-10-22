# Practice discovery

Issues #54 and #59. `/practice` uses a compact responsive question table: title and real topic tags, difficulty, available languages, and workspace links. No synthetic progress or solved status.

## Query contract

`GET /v1/problems` accepts `q`, `difficulty`, `topic`, `sort`, `order`, `page`, `limit`. Search is a literal case-insensitive substring of title, slug or tags; `%` and SQL syntax have no special meaning. Difficulty accepts comma-separated easy/medium/hard values. Topic accepts comma-separated authoritative tags. Each group matches any selected value; difficulty and topic groups apply together. Title sort is default; difficulty sorts easy → medium → hard, with title/slug ties. Ascending is default.

Defaults: page 1, limit 20; maximum page 10,000 and limit 100. Text bounds: 120 Unicode code points for q, 80 per difficulty/topic value, up to 16 values per group. Invalid enum, numeric, duplicate or oversized recognized parameters return 400. SQL binds all user strings; ordering uses fixed server fragments. Public projections exclude hidden cases/reference solutions.

Response retains `items` and adds filtered `total`, `page`, `limit`, and unfiltered `topics`. Page/count/topics share a read-only repeatable-read snapshot. Page payload is bounded; search/count currently scan published metadata, appropriate for the initial catalog. Add indexed search only after measured catalog growth. Existing catalog consumers receive the default first page; competitive/admin full-catalog navigation remains separately scoped.

## Browser state

The table uses alternating row backgrounds without an enclosing card. Clicking a row opens its problem; title links retain keyboard and browser link behavior. Clicking difficulty/topic buttons adds that value to existing filters. Difficulty and topic popovers support multiple selections through wrapping pressed-state chips. Trigger summaries expose active choices; Clear resets a group. No Any option.

Filters/sort/page live in URL params. Search debounces 250ms and replaces its current history entry; discrete filter/sort/page actions add entries. Back/forward restores controls. Changed filters reset pagination; out-of-range bookmarks canonicalize to the last valid page. Query-key isolation plus abort signals prevent stale results appearing under newer filters. Independent metadata cache keeps topic options available while filtering/loading. Empty, loading and retry states are explicit. Narrow layouts omit the language column and retain question topics and title links.

## Evidence

- `vp check` and contract generation/check.
- Frontend URL normalization tests, HTTP validation tests, PostgreSQL literal search, combined filters, stable pagination/count/options, difficulty ranking and out-of-range page tests.
- PostgreSQL tests use only `quorem_discovery_refresh_test`, never the running development database.
- Initial gallery validation: live worktree Vite at `http://127.0.0.1:5182/practice`, API 8092 on that disposable DB: search updates URL and returns the correct question; topic/back restores filter; full topic options persist; page=999 canonicalizes to page 1.

- Issue #59: live root Vite at `http://localhost:5180/practice`, API 8090: multiple difficulties/topics, additive tag clicks, and non-link row navigation verified.

- Difficulty controls have a semantic hover/focus tint; difficulty/topic interaction suppresses row highlighting. Trailing row arrows are removed.
