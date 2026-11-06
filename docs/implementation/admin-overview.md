# Admin overview

`/admin` shows platform aggregates to administrators. Every `/admin/*` route shares admission: account sign-in when anonymous/guest, 404 for other accounts. Navigation rechecks the session; a shared render boundary handles later session changes.

Question authoring lives at `/questions`, available to admins and accounts with `authorCustomQuestions`. Its existing API ownership, private-content and global-publication permissions remain authoritative; global publishing requires an administrator.

`GET /v1/admin/overview` verifies identity and rechecks the live, enabled administrator row in a read-only PostgreSQL snapshot. Details are bounded to eight active accounts and five shared draft updates. Private question titles, submission source and email addresses are excluded. Queries have statement and lock timeouts.

Seven-day activity uses retained Submit history, excludes Run operations, and includes guest submissions in the platform submission total. Active-account counts exclude guests. Pending execution counts include queued/running Run and Submit operations. These counts are operational snapshots, not lifetime analytics.

The dashboard keeps its previous snapshot during refresh and refresh errors. Persistent recovery accompanies stale data; initial errors and empty collections have dedicated states. `overview.fixture.ts` supplies illustrative local data for UI checks.
