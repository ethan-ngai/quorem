# Future cache and semantic retrieval seams

[Plan index](README.md)

Scope now: preserve replaceable query/retrieval boundaries and document their semantics. **Do not implement KV caching, Redis, embeddings, vector databases, indexing workers or semantic-search endpoints.** Do not provision their resources or add unused production bindings/dependencies.

## Cache insertion point

Use a consumer-owned immutable-content read contract, for example `readPublishedContent(versionId, projectionVersion)`. Its current PostgreSQL implementation remains the only path. A future cache decorator can wrap that loader while the query service still owns access checks and public/private projection.

- Resolve slug/current-version pointers and authorize using fresh authoritative state first. Cache immutable version-addressed public content only where declared safe.
- The domain read contract exposes content identity/version, not `KVNamespace`, TTLs, cache key strings or provider errors. Future caching policy belongs to the decorator/composition owner.
- Define projection/schema version, visibility scope and locale/other output dimensions in future keys. Never reuse a public/private/interviewer key space.
- PostgreSQL remains the authority for existence, visibility, entitlement, deletion and revocation; immutable content can become inaccessible. Future cache hits still require those live checks. Never serve cached deleted content after a failed authority lookup.
- Cache failure may fall back to the loader for eligible immutable content. Never apply cache-fallback rules to session authority, quotas, document epochs, leases, current-match membership or idempotency.
- Prefer versioned keys; postcommit invalidation alone cannot establish security correctness. Future stampede control belongs around the loader and cannot change command serialization.

Cloudflare KV is eventually consistent and unsuitable for authoritative coordination. This motivates the seam; no KV adapter is part of this migration. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

Future acceptance: fake stale hit, revocation/delete between lookup and response, schema-version mismatch, cache outage and two-caller deduplication tests. Add executable cache contracts only when a cache implementation is authorized; now test the real loader's authorization/projection contract.

## Candidate retrieval insertion point

Keep discovery and match selection behind focused existing-use-case contracts: validated filters/context -> candidate identities with stable version identity -> authoritative hydration and policy checks. Implement current catalog/selection behavior using PostgreSQL; do not add unused semantic APIs.

- A future lexical/vector/hybrid retriever supplies candidate IDs and opaque ranking metadata. Domain policy chooses allowed questions, deduplicates and applies difficulty/language/host-library rules.
- IDs/scores from an index never establish visibility or current publication. Rehydrate from PostgreSQL and reauthorize; keep atomic match reservation/selection constraints in the existing command transaction.
- No embedding vectors, vendor filter language or ANN tuning in application contracts. Keep enrichment/reranking optional and composition-owned.
- For future query embeddings, perform slow external I/O before acquiring domain locks; revalidate constraints during final selection. Cap candidate count and retrieval time; specify whether outage falls back to current deterministic SQL or fails.
- Preserve keyset catalog pagination now. A future ranked search owns an explicit ranking/query/index version or opaque cursor rather than reusing SQL cursors incorrectly.
- A future index projection uses stable IDs, content revision, privacy classification and tombstones; retries/deduplication and reindex/backfill semantics belong to a separate indexing owner. Reuse durable-work primitives, not an execution queue contract.
- Never embed hidden cases, contestant source or private interview snapshots by default. Private-library indexing needs a separately approved access/data-retention design.

Future acceptance: stale/deleted/private candidates are filtered, deterministic fallback preserves existing policy, duplicate IDs collapse, model/index revisions do not corrupt pagination. Current tests exercise the PostgreSQL candidate contract and authoritative hydration without an external search service.

## Extension rule

Prefer one real PostgreSQL implementation behind a narrow use-case contract over an unused plugin registry. Agent adding a future adapter should change composition + adapter + conformance tests; existing commands/policies should need no provider-specific branches. New semantics still require a deliberate application contract change.
