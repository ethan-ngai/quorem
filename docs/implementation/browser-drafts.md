# Browser drafts

Competitive workspace replaces server drafts with browser-only source/history.

- Practice scope: identity + immutable problem version + Python. Match scope additionally includes the private workspace ID.
- Latest code coalesces into a browser write after cursor paint; page closure, navigation and explicit save flush it synchronously. IndexedDB keeps up to 100 snapshots for 30 days. Empty code is a valid draft.
- Windows keep independent active buffers. Latest browser write resumes on reload; no remote source replaces an open editor.
- Existing IndexedDB recovery imports automatically if no current browser draft exists. History restore preserves edits made while a save is pending.
- API workspaces hold metadata only; Run/Submit retain immutable source snapshots for judging. Draft endpoints/tables and workspace source/revision columns are absent from the database baseline.

## Legacy development data

The current [database baseline](database.md) contains no server draft tables. Older draft exports remain importable through Settings > Drafts > Import previous drafts. Existing browser drafts win; historical copies stay in the private backup. Never commit source backups.

## Validation

Browser storage tests cover empty drafts, stable practice scope, owner/version/match isolation, independent window buffers, malformed storage and non-overwriting legacy import. Go HTTP tests ensure removed restore routes return 404; workspace persistence tests cover reuse/owner isolation. PostgreSQL tests require a disposable test database.
