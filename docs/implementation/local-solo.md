# Local solo milestone

Verified 2026-10-10. Sol 6.1 handled contracts, infrastructure, API/judge, and review; Luna 6 handled the editor. Integration uses the planning PR as its base.

## Implemented

- React/TanStack workspace, CodeMirror 6, modern CSS; system/light/dark themes, keyboard resizing, narrow-screen panes and editor preferences.
- Isolated Python language service: type-aware completion, hover, signatures, syntax/type diagnostics. Explicit tab takeover; one language container per development identity.
- PostgreSQL owner-scoped drafts, serialized autosave, retained revisions, restore, IndexedDB recovery. Empty drafts remain empty; route/identity changes and delayed restores preserve newer edits.
- Durable admission with idempotency, one active execution per owner, fenced leases/retries, cancellation and orphan cleanup.
- Docker Python 3.12 judge, public/custom Run diagnostics, private Submit summary; ListNode/TreeNode codecs and six original versioned problems with 20 hidden cases each.
- Development Alice/Bob identities; static match preview; one-command local supervisor. CI builds and runs contracts, editor, language, PostgreSQL, and Docker tests.

## Evidence

- `make dev`: database, image builds, seeds, API, runner, language service, and browser start successfully.
- `make check`: formatting, lint/types, generated-contract drift, four editor tests, language unit tests, Go tests/vet pass.
- `QUOREM_DEV_IDENTITY=true QUOREM_LANGUAGE_TEST=true vp run --filter @quorem/language test`: all six pass, including real Python capabilities, owner takeover, teardown and close/reopen lifecycle.
- `QUOREM_TEST_DATABASE_URL=… QUOREM_TEST_DOCKER=1 go test ./...`: real PostgreSQL and Docker suites pass. Dedicated test database keeps development drafts intact.
- `make build`: web and Go builds pass. Browser verifies autosave/reload, user isolation, empty draft navigation, history restore, real completion/signatures, public/custom Run, Run cancellation, bounded runtime tracebacks, and accepted hidden Submit (20/20).
- Desktop 1440×900 and narrow 390×844 inspected. Narrow document width equals viewport width. Both color themes inspected.

## Remaining gates

Real 1v1, Better Auth/Cognito, Astro marketing, Terraform/AWS and public deployment remain later tickets. Development Docker is not the approved public sandbox: run the documented gVisor/escape/resource release gate before accepting public code. No AWS credentials used.

The initial editor bundle is approximately 905 kB minified / 297 kB gzip and emits a chunk-size warning. Split editor/language dependencies before public delivery. Load target and $100 AWS budget remain unvalidated.
