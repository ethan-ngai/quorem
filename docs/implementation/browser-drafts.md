# Editor autosave

- Practice keeps the latest browser autosave per identity, publication ID and language. Match drafts use the private workspace ID.
- Writes coalesce after cursor paint. Page closure, navigation and explicit save flush them synchronously. Empty code is a valid autosave.
- Windows keep independent active buffers. The latest browser write resumes on reload.
- If a workspace has no autosave, its latest older IndexedDB snapshot can initialize one.
- Active competitive matches also save current code for post-match review. Run and Submit capture immutable source snapshots for judging.
