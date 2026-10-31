# Canonical codecs and cross-runtime values

[Plan index](README.md)

This is a cross-runtime contract task, not a generic `JSON.parse` rewrite.

- Inventory database `bigint`, revisions, durations, SQL numeric values and case integers. Keep exact values as strings/`bigint` internally where needed; validate safe conversion at public boundaries. `JSON.stringify` cannot serialize `bigint`; a global number parser override silently loses precision.
- Preserve lossless JSON numeric lexemes where question inputs/results require them. Choose and pin a parser/encoder only after golden vectors establish existing semantics. Include negative zero, exponent forms, integer bounds, PostgreSQL numeric/real/double and timestamp ordering/comparison cases.
- Preserve omitted/null/empty-array distinctions, UUID validation and canonical source bytes. Use UTF-8 byte lengths, not JS string lengths, for limits/hashes.
- Keep public examples separate from private fixtures in SQL projections and DTOs. Preserve opaque `bytea` sidecars for NUL-bearing cases/results and compressed checkpoint frames; never round-trip them through JSONB.
- Fingerprints, snapshot hashes, source hashes and operation responses must continue recognizing existing records. JS property order/escaping differs from Go serialization. Build explicit compatibility vectors for stored hashes; avoid recomputing historical identity from a new generic serializer. If a hash scheme must change, design an explicit versioned migration before activation.
- CodeMirror uses UTF-16 offsets. Prefer the existing official ChangeSet format/library where compatible, with explicit source validation, byte caps, surrogate-pair rejection, epoch/version checks and idempotent retry semantics. Test emoji, combining text, lone surrogates, empty inserts and split pairs.

Canonical question semantics belong to `packages/questions`, not API-private utilities: validation, signatures, starter generation, constraint interpretation, case normalization and comparison. Keep codecs pure; no database, Hono or provider imports. Reuse the existing public question schema; do not introduce a second independently authored model.

`packages/execution` consumes question values and owns runtime/harness revisions, private job/frame/checkpoint wire codecs. It never makes hidden data part of `packages/contracts` exports. Decode DB rows and provider responses explicitly; Drizzle type inference alone is not runtime validation.
