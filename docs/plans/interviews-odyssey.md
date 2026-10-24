# Interviews and Odyssey

Ledger: [#115](https://github.com/ethan-ngai/quorem/issues/115).

## Product contracts

- Interviews are separate from competitive matches. Multiple interviewers and interviewees collaborate in one shared code document; all members edit/run. Interviewers manage questions, tests and membership.
- Hosts require `interviews.host`; invited accounts and guests do not. Guest credentials are interview-scoped. Sessions persist for resumption.
- Select a catalog question or privately define starter code, method contracts and tests. Custom interview content never enters the public catalog.
- Odyssey is an independent question mode usable in solo practice and interviews. `problems.odyssey` gates solo access; interview participants inherit the host's session access.
- Only initial starter code is supplied. Later levels specify APIs; candidates write new methods/stubs without replacing earlier source.
- Stateful tests contain ordered calls sharing one object; independent cases start fresh. Preserve existing language/runtime isolation.
- Server unlocks the next level only after accepted submission against all tests from levels 1 through N. Future levels and private cases stay server-side until authorized.

## Implementation order

1. Independent audited feature grants; admin role never implies feature access.
2. Interview aggregate, membership/invites, durable document edits and private execution snapshots.
3. Odyssey immutable authoring/model, per-case dispatch, cumulative admission and authoritative progress.
4. Shared editor synchronization, interview setup/session/invite flows, Odyssey authoring/progress.
5. Integrate on `dev`; disposable PostgreSQL, harness and browser validation. No `main` promotion or cloud deployment.

Concurrent branches own interview backend, Odyssey backend/judging and frontend/contracts. The orchestrator owns flags, integration and final verification. Contracts are agreed before cross-branch integration.

## Consistency and privacy

PostgreSQL serializes and persists document edits. CodeMirror clients retain pending edits, pull intervening updates and rebase before retrying a stale push. Stable client identities and retry deduplication prevent duplicate application. Reconnection recovers from durable versions, not process-local memory.

Execution binds source, suite, language and level at admission. Reuse existing queue/lease fencing and admission protections; shared results require session membership. Authoritative completion drives level progress. Restrict private test inputs, expected values and captured output to interviewers. No client-supplied verdict/progress authority.

## Acceptance

- Concurrent and Unicode edits converge; retry/reconnect preserves source and undo.
- Unflagged hosts fail; invitees join without flags; revocation/closure removes access.
- Private custom content cannot leak through public catalog/version endpoints.
- Stateful calls retain object state within a case and reset between cases.
- Later suites include prior tests; regressions block advancement; locked/future content stays hidden.
- Existing single-method questions, matches and language execution remain compatible.
- Live Vite/HMR validation uses the original checkout at `http://127.0.0.1:5180` after verifying process cwd.

## Operations

Use the existing operator access command with scopes `interviews.host` and `problems.odyssey`; the existing `internal` bundle includes both. Grants support expiry/revocation and append-only audit. Local development uses fixtures and a separate disposable integration database. Provisioning remains Terraform; deployments remain GitHub Actions.
