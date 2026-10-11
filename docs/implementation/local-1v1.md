# Local 1v1 checkpoint

Verified 2026-10-10. Builds on the solo checkpoint. Sol 6.1 handled match authority, workspace redesign, integration and review; Luna 6 handled realtime recovery.

## Delivered

- Private create/invite/join/lobby routes, host difficulty/duration settings, readiness, fresh private match workspaces, server-anchored timer, safe opponent progress and explicit concession.
- PostgreSQL locks serialize seats, per-owner reservations, admission, outcomes and expiry. Correct submissions rank by admission time and sequence; deadline scoring uses best hidden-test counts. Outcome-relevant uncertainty gets a persisted two-minute finalization window.
- Late completions preserve owner history without reopening outcomes. Same-owner uncertainty cannot block an already certain winner. Match Submit remains irrevocable; Run remains cancellable.
- Provider-neutral PubSub/Presence interfaces, local authenticated WebSockets, transactional outbox, bounded connections/subscribers, subscribe-then-fetch recovery, version checks and REST polling fallback.
- Linear-informed editor: neutral themes, soft boundaries, one toolbar and a shared editor/results surface. Coding-site problem hierarchy uses named inputs, direct prose and optional topics; code ligatures disabled. Grouped settings and narrow-screen pane navigation remain. Static match preview removed.
- Owner-scoped mutation retry keys preserve exact create payloads after uncertain responses; invitations survive reload. Source recovery, route/identity fencing and immutable problem-version loading protect drafts and execution context.

## Evidence

- `make dev`: complete local stack starts without AWS credentials; database and existing drafts survive restart.
- `make check`, `make build`: generated contracts, formatting, TypeScript, Go/vet and frontend checks pass. Frontend has 24 tests covering recovery, version ordering, execution guards and statement rendering.
- `QUOREM_TEST_DATABASE_URL=… QUOREM_TEST_DOCKER=1 go test -race ./...`: real PostgreSQL and Docker suites pass. HTTP tests use isolated schemas; adapter tests use a dedicated test database.
- Database tests cover reservation/replay races, version selection, strict deadline admission, timeout scores/draws, uncertain work, restart/late-completion cutoff, forfeit and frozen progress.
- WebSocket tests verify membership/origin authorization, private payloads, rejection of browser publication, durable outbox acknowledgement and outcome recovery after API restart.
- Two browser identities create/join/ready/start, edit independently, judge a correct solution (20/20), and receive the same winner. A second match verifies invitation reload recovery and explicit forfeit. Persisted results survive service restart.
- Light/dark desktop inspected; repaired settings popover verified. At 390×844, document width equals viewport width; problem/code/results navigation works. Browser console has no application warnings/errors on the verified flow.

## Local operation and remaining gates

Use `make dev`, open http://localhost:5173, create Private 1v1, and open its invitation in another tab with Bob selected. Development identity selection is intentionally local-only.

Invite hashes are durable; create-response replay encrypts the token using `QUOREM_INVITE_KEY` (base64url, 32 bytes) or a generated owner-only local cache file. Preserve that key across restarts. Key loss invalidates old create-response replays; existing invite links still join through their stored hashes.

Realtime presence is process-local and advisory. Shared/cloud fanout remains an adapter milestone. Public Better Auth/Cognito, Aurora, AppSync Events, Terraform/deployment and Astro remain later tickets. Public sandbox approval, the $100 AWS budget and the 40-session load target remain unvalidated. Initial web bundle is about 931 kB minified / 304 kB gzip; split editor dependencies before public delivery.
