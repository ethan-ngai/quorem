# Local 1v1 checkpoint

Verified 2026-10-11. Builds on the solo checkpoint. Sol 6.1 handled match authority, workspace redesign, integration and review; Luna 6 handled realtime recovery.

## Delivered

- Private create/invite/join/lobby routes, host difficulty/duration settings, readiness, fresh private match workspaces, server-anchored timer, safe opponent progress and explicit concession.
- PostgreSQL locks serialize seats, per-owner reservations, admission, outcomes and expiry. Correct submissions rank by admission time and sequence; deadline scoring uses best hidden-test counts. Outcome-relevant uncertainty gets a persisted two-minute finalization window.
- Late completions preserve owner history without reopening outcomes. Same-owner uncertainty cannot block an already certain winner. Match Submit remains irrevocable; Run remains cancellable.
- Provider-neutral PubSub/Presence interfaces, local authenticated WebSockets, transactional outbox, bounded connections/subscribers, subscribe-then-fetch recovery, version checks and REST polling fallback.
- Linear-informed editor: neutral themes, soft boundaries, navigation toolbar and a shared editor/results surface with bottom Run/Submit actions. Samples and Custom cases use a HackerRank-style scrollable left case rail with execution details attached to the admitted case snapshot. Coding-site problem hierarchy uses named inputs, text-fitting example backgrounds, optional explanation space, and title-cased topic labels in a compact reserved row; code ligatures disabled. Grouped settings and narrow-screen pane navigation remain. Static match preview removed.
- Custom cases expose per-argument typed controls, optional expected output, 1–20 stable case rows and scoped browser persistence. Server admission rejects invalid recursive codecs, node shape, empty custom suites and oversized payloads before reserving a job.
- Editor schemes: Workspace, JetBrains Light, Darcula and One Dark, independent of app theme. Native Python tags share one Lezer version; parameter/decorator context and visible lexical builtin/self accents improve distinction. Switching retains document/cursor/undo; named syntax palettes pass 4.5 contrast on normal and active-line surfaces.
- Python intelligence disposes closed transports and pending requests, preserves document notification ordering, resolves completion documentation lazily, and reconnects after repeated request timeouts. Healthy connection chatter is removed; outages retain recovery controls.
- Owner-scoped mutation retry keys preserve exact create payloads after uncertain responses; invitations survive reload. Source recovery, route/identity fencing and immutable problem-version loading protect drafts and execution context.

- Parameter-aware constraints use ranges, comparisons, sequence properties and prose fallback. API admission and browser feedback share the typed contract. Examples use strict signature binding and preserve explanations separately from execution cases; immutable version upgrades retain earlier drafts and submissions. See [problem metadata](problem-metadata.md).

## Evidence

- `make dev`: complete local stack starts without AWS credentials; database and existing drafts survive restart.
- `make check`, `make build`: generated contracts, formatting, TypeScript, Go/vet and frontend checks pass. 48 frontend tests and two live-service integration tests pass; they cover recovery, version ordering, execution guards, statement rendering, result privacy and editor scheme/grammar/undo behavior.
- `QUOREM_TEST_DATABASE_URL=… QUOREM_TEST_DOCKER=1 go test -race ./...`: real PostgreSQL and Docker suites pass. HTTP tests use isolated schemas; adapter tests use a dedicated test database.
- Database tests cover reservation/replay races, version selection, strict deadline admission, timeout scores/draws, uncertain work, restart/late-completion cutoff, forfeit and frozen progress.
- WebSocket tests verify membership/origin authorization, private payloads, rejection of browser publication, durable outbox acknowledgement and outcome recovery after API restart.
- Two browser identities create/join/ready/start, edit independently, judge a correct solution (20/20), and receive the same winner. A second match verifies invitation reload recovery and explicit forfeit. Persisted results survive service restart.
- Real PostgreSQL admission rejects invalid parameter ranges, cross-parameter comparisons and aggregate sums before creating jobs. Typed metadata, Unicode measurements, tree projections, properties, legacy versions and explanation isolation have regression coverage.
- Browser custom input rejects wrong element types and cross-parameter constraints, then executes a valid case; changing an admitted value detaches its old result.
- Cold global-prefix regression reproduces cache thrashing/engine exits at a 192 MiB heap. Local language sessions now have a 384 MiB heap inside a 512 MiB container; repeated requests retain the cache. A measured cold completion took 1.312s and warmed completions 20–190ms; browser local suggestions appeared in 231ms. These are local measurements, not public latency guarantees. Basic completion remains during initialization/reconnect, and bounded documentation popovers scroll within the viewport.
- Automatic Python member completion verified in the browser without an explicit completion shortcut. Real language-service integration covers completion documentation, hover, signatures, syntax/type diagnostics, reconnect and takeover; transport tests cover pending requests and timeouts.
- Light/dark desktop inspected; repaired settings popover verified. At 390×844, document width equals viewport width; problem/code/results navigation works. Twenty custom Run cases verify independent rail scrolling; bottom actions remain visible across narrow-screen panes. Public/custom Run and hidden-suite Submit passed in the browser.

## Local operation and remaining gates

Use `make dev`, open http://localhost:5173, create Private 1v1, and open its invitation in another tab with Bob selected. Development identity selection is intentionally local-only.

Invite hashes are durable; create-response replay encrypts the token using `QUOREM_INVITE_KEY` (base64url, 32 bytes) or a generated owner-only local cache file. Preserve that key across restarts. Key loss invalidates old create-response replays; existing invite links still join through their stored hashes.

Realtime presence is process-local and advisory. Shared/cloud fanout remains an adapter milestone. Public Better Auth/Cognito, Aurora, AppSync Events, Terraform/deployment and Astro remain later tickets. Public sandbox approval, the $100 AWS budget and the 40-session load target remain unvalidated. Initial web bundle is about 946 kB minified / 310 kB gzip; split editor dependencies before public delivery.
