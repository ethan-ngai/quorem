# Contracts — baseline for Q3

Q3 turns this specification into OpenAPI 3.1 and JSON Schemas, generates TypeScript types/client calls, and commits contract fixtures before dependent implementation. Unknown fields rejected on commands; response additions may be ignored by old clients. Version breaking wire changes explicitly.

## Common types

- IDs: opaque UUID strings, never client-supplied owner identifiers. UTC timestamps: RFC3339. Sequence/revision/cursor values: decimal strings so JavaScript precision is preserved.
- Language: `python`; difficulty: `easy|medium|hard`; source: UTF-8 under operating limits.
- Error response: `{error: {code, message, requestId, details?}}`; safe details only. Standard statuses: 400 invalid_input, 401 unauthenticated, 403 forbidden, 404 not_found, 409 user_busy/invalid_transition/idempotency_conflict/stale_session_save, 413 payload_too_large, 429 quota_exceeded/queue_saturated, 503 temporarily_unavailable. Ownership-sensitive resources return 404 to unrelated identities.
- `Idempotency-Key` header required for execution/match mutation commands, scoped to subject+route. Store body fingerprint and response for 24 hours. Retry same key/body returns original result; different body conflicts. Idempotent retry is resolved before busy admission so the original job is retrievable.

## Problems and typed input

Public ProblemVersion: `{id, slug, version, title, difficulty, tags, statementMarkdown, examples, constraints, signature, starterSource, runtimeRevision, limits}`. Signature: `{className: 'Solution', methodName, parameters: [{name,type}], returnType}`. No hidden-suite locations, expected values, or trusted reference source in public schema.

Type grammar: `int`, `float`, `bool`, `str`, `list<T>`, `optional<T>`, `ListNode`, `TreeNode`. Start node values as int; acyclic singly-linked lists and ordinary binary trees only. Integers on the wire restricted to exact signed 32-bit values initially; reject out-of-range fixture/custom/output integers. Python may use arbitrary integers internally. Extend large integer wire encoding explicitly later, not via lossy JavaScript numbers. Floats must be finite, with fixture-specific tolerance when used; no implicit tolerance for integer/string/list comparison.

Custom cases: `{args: [typed values in parameter order]}`; optional public `expected` for comparison. Without expected, Run returns actual result and run status, not a misleading accepted verdict. Reject malformed shapes/types before queueing. ListNode is array-or-null (empty array normalizes to null); TreeNode is breadth-first array-or-null with null gaps, canonical trailing-null trimming. Reject orphans/cycles/aliases/out-of-bound sizes; maximum 10,000 node/collection elements and nesting depth 100. Output cycle/oversize is a contestant invalid_output failure. Ordered deep equality is default; per-fixture declared unordered-list/float comparator overrides are immutable and shared by Run/Submit. Empty null-node output normalized consistently.

Seed set: six original fixtures, two per difficulty, including list/tree algorithms. Each has 20 hidden cases, public examples, reference solution, typed signature, runtime revision, immutable comparator/limits, attribution. Validate reference acceptance and representative incorrect solutions; public templates and harness/type stubs must agree. Fixture administration stays in Git.

## Workspace/draft endpoints

- `POST /v1/workspaces`: `{problemVersionId, language}` → owned solo Workspace; reuse unique owner+problem-version+language solo workspace.
- `GET /v1/workspaces/{id}` → `{id, kind: solo|match, problemVersionId, language, matchId?, draft, preferences}`. Match workspace allocated only at start, initialized from template rather than solo source.
- `GET /v1/problems/{slug}` → current public ProblemVersion; `GET /v1/problem-versions/{id}` → immutable public version, but enforce unrevealed-match access separately. No public match snapshot leaks chosen version before start.
- `PUT /v1/workspaces/{id}/draft`: `{source, editorSessionId, saveSequence}` → `{revision, savedAt}`. Atomic history capture/revision increment. Reject duplicate/older sequence from that same session; writes from different sessions follow server commit order. Do not overwrite the client buffer on save response.
- `GET /v1/workspaces/{id}/draft-history?cursor&limit` → owned snapshots, default 20/max 100; keyset newest-first. `POST .../restore`: `{revision}` → a new active revision; restore never mutates old snapshots.

Preferences hold theme (`system|light|dark`), pane ratios, code font size (12–24px), tab size (2|4), wrap flag. Browser-local preference storage first; server preference endpoint optional only when needed, no implicit requirement for cross-device preferences.

## Execution

`POST /v1/submissions`: `{workspaceId, kind: run|submit, source, customCases?}` → 202 `{id, state, sourceHash, admittedAt}`. Server derives owner/language/problem/match from authorized workspace; rejects mismatched custom cases, unrevealed/not-active match, closed deadline or busy owner. Run uses chosen public/custom cases; Submit always server-held hidden suite. Admission transaction snapshots source/version, reserves busy slot, enqueues job and assigns match sequence when applicable.

`GET /v1/submissions/{id}` → `{id, workspaceId, kind, state, sourceHash, admittedAt, updatedAt, verdict?, score?, publicCases?, diagnostics?, infrastructureError?}`. State: `queued|running|completed|cancelled|failed`. Verdict: `accepted|wrong_answer|syntax_error|runtime_error|time_limit|memory_limit|output_limit|invalid_output`; custom Run without expected uses per-case `executed` status and no accepted claim. Score: `{passed,total}` only for complete Submit suites, including contestant-error cases. No opponent source and no hidden per-case diagnostic/expected/input fields. Infrastructure failure is state `failed`, never a contestant verdict. Owner source retrieval may be a separate authorized endpoint; opponent progress uses match summaries only.

`POST /v1/submissions/{id}/cancel`: Run or solo Submit only; admitted match Submit returns invalid_transition. Cancellation fencing discards late completion and releases busy slot only after process teardown or durable nonexecution confirmation. Failed/cancelled jobs do not contribute to match score.

Job contract: `{jobId, submissionId, attemptId, problemVersionId, runtimeRevision, harnessRevision, sourceRef, suiteRef, limits}`. Controller fetches trusted suite separately from sandbox. Completion: `{submissionId, attemptId, verdict?, score?, safeDiagnostics?, publicCaseResults?, engineFailure?}` through authenticated internal application service; no browser can call worker completion. Version/schema validate and fence each write.

## Matches

- `POST /v1/matches`: `{difficulty, durationMinutes: 15|30|45|60}` → `{id, inviteUrl, state}`. Host seat, 24-hour invite. Opaque invite capability permits joining only after authentication; never reading private participant data by itself.
- `POST /v1/matches/join`: `{inviteToken}` → owned MatchSnapshot. Atomic two-seat claim and per-user active-match reservation.
- `POST /v1/matches/{id}/ready`: `{ready: boolean}`. Both ready triggers locked random selection, immutable start/duration/deadline and fresh match workspaces.
- `POST /v1/matches/{id}/forfeit`: immediate concession before completion. `POST .../leave`: pre-start guest leaves or host cancels; after start use forfeit.
- `GET /v1/matches/{id}` → MatchSnapshot: `{id, version, state, serverNow, difficulty, durationMinutes, participants, startedAt?, deadline?, finalizingAt?, problemVersionId?, outcome?}`. Participants: own identity/display label, readiness, advisory presence, safe submission status, best score. No source, email, tokens or hidden cases. Reveal version/workspace only after start.
- Outcome: `{kind: win|draw|no_contest|cancelled, winnerUserId?, reason, completedAt}`. Receipt sequence decides correct-solution ordering; best eligible score decides timeout; no submissions score zero. Forfeit serialized with completion; no contest if uncertain after two minutes.

## Events and recovery

Deadline admission uses actual database time after locking the match; transaction-start `now()` cannot authorize late blocked requests. Expired waiting/ready matches release reservations; completed outcomes/progress stay immutable despite late worker results.

Envelope: `{eventId, schemaVersion: 1, aggregateId, aggregateVersion, type, occurredAt, payload}`. Types: `submission.updated` (owner only), `match.updated` (participants only), `match.completed` (participants only). Publish snapshots/safe summaries sufficient to invalidate/refetch; no source or hidden diagnostic payload.

Transport separates subscribe authorization from publisher authority. Connect/subscribe then fetch snapshot; buffer updates during snapshot fetch, apply only newer aggregate versions. Gap/out-of-order detection refetches snapshot; reconnect always refetches. No durable transport guarantee or permanent replay buffer assumed. Outbox dispatcher publishes at least once; unique event IDs/version checks deduplicate. REST polling fallback exposes the same authoritative state.

Local event channels and AppSync channels implement the same topic templates: `/users/{internalUserId}/submissions`, `/matches/{matchId}`. Verify exact owner/membership at subscribe; forbid wildcard widening. Backend publishes via privileged adapter; clients cannot publish authoritative state.
