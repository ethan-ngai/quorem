# Browser drafts

Competitive workspace replaces server drafts with browser-only source/history.

- Practice scope: identity + immutable problem version + Python. Match scope additionally includes the private workspace ID.
- Latest code saves locally on edits; IndexedDB keeps up to 100 snapshots for 30 days. Empty code is a valid draft.
- Windows keep independent active buffers. Latest browser write resumes on reload; no remote source replaces an open editor.
- Existing IndexedDB recovery imports automatically if no current browser draft exists. History restore preserves edits made while a save is pending.
- API workspaces hold metadata only; Run/Submit retain immutable source snapshots for judging. Draft endpoints/tables and workspace source/revision columns are removed by migration 060.

## Legacy development data

Before running migration 060 against an existing database, export its drafts to a private file outside the checkout:

```sh
scripts/export-browser-drafts.sh "$DATABASE_URL" /private/path/quorem-drafts.json
```

This command is read-only and exports latest drafts plus historical copies. Settings > Drafts > Import previous drafts imports missing latest drafts for the selected identity; existing browser drafts win. Historical copies remain in the private backup. Never commit this file.

For preview validation, clone the existing database and migrate the clone; retain the original until the browser import is verified.

## Validation

Browser storage tests cover empty drafts, stable practice scope, owner/version/match isolation, independent window buffers, malformed storage and non-overwriting legacy import. Go HTTP tests ensure removed restore routes return 404; workspace persistence tests cover reuse/owner isolation. PostgreSQL tests require a disposable test database.
