# Shared foundations audit

Ledger: [#156](https://github.com/ethan-ngai/quorem/issues/156). Scope: frontend imports/styles and room lifecycles, execution admission, schemas/contracts, browser storage and legacy authoring/draft paths.

## Consolidated ownership

- `ui` owns icons, tooltip/dialog/share styling, focus restoration, pending dismissal and share state. Shared button CSS owns focus, disabled behavior and reduced motion.
- Editor, result, statement and machine-value components import their own CSS. Marketing reuses them without importing the workspace page stylesheet. Shared insets and distinct marketing CTA classes prevent missing padding and selector collisions.
- `features/rooms` owns rule monitoring, monotonic alert tracking, toast presentation and history. Realtime owns authenticated socket lifetime, retry and stale-callback fencing. Domain frame validation, authority and recovery protocols remain specific to each room.
- PostgreSQL execution admission owns account concurrency/rate/daily limits, global queue capacity and sponsor concurrency across room types. Existing participant/room/sponsor/queue lock order and domain-specific rejections remain intact.
- `api/client` owns authenticated typed transport and approved safe errors. Interview HTTP/socket errors share their domain mapping. Server messages never become arbitrary product copy.
- Browser settings own display preferences. Removed unused server preference payloads with contradictory defaults; persisted values are validated and blocked storage does not prevent session changes.
- OpenAPI owns shared wire models. Event definitions and TypeScript declarations are generated; envelope-specific structure lives in its small template.
- Product/auth each have one declarative baseline. Checked local adoption changes only migration ledgers after exact catalog comparison; application rows remain intact.

## Removed or repaired

Removed disconnected Odyssey authoring, obsolete server-draft export/backfill paths, legacy tooltip/sharing wrappers, old match request-hash compatibility and orphan preview/styles. DESIGN.md now records durable values derived from user feedback, rather than accumulated component recipes.

Fixed HTTP LAN hashing without Web Crypto, interview state retained across route IDs, token-failure socket recovery, closed-socket callbacks, malformed API errors/preferences, duplicate React-root mounting under HMR and programmatic dialog focus restoration.

## Validation

`make check` passed with separate disposable product/auth databases: formatting/lint/types, contracts, 307 web tests, 59 auth tests, language tests, Go tests and vet. Full Go race tests also passed. Optional service-dependent tests remain skipped by their existing gates.

Live Vite/HMR: original checkout, `http://localhost:5180`. Marketing checked in both themes and narrow/desktop layouts; shared padding, controls and no horizontal overflow verified. App checks covered create dialog/select stacking, editor/result geometry, a real Alice/Bob match rule-event toast and persistent history, and safe forfeit focus/cancel/restoration. The verification match was completed afterward.

This audit preserves distinct execution semantics: interviews flush collaborative documents and validate epochs; competitive submissions admit independent immutable source snapshots. Sharing transport and admission policy does not combine these authorities.
