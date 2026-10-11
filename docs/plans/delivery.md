# Delivery — local first

## Local baseline

Document `make dev` to start PostgreSQL, Go API, judge worker, separate language service, local WebSockets and Vite+ web app; `make seed` migrates/seeds and `make reset` resets development data with an explicit development-only check. Root Makefile orchestrates services; TypeScript subcommands use `vp`. Integrated auth mode adds Better Auth with mocked/local provider contracts; Cognito stays out of the no-credentials path. Pin versions, fixture IDs and test identity mapping. Mock/live transports share contract tests; mocks alone cannot certify multiplayer.

Suggested modes: UI fixtures (no services), integrated solo (real DB/judge), integrated 1v1 (two identities). Never accept development identity in production. Publish `.env.example` with placeholders; no live AWS dependency for these modes. CI should run integrated tests on disposable services without personal credentials.

Observed host: Go, Docker command, `vp` command available; Terraform command absent. CLI presence does not prove runtimes/services are healthy. Verify during implementation, not install speculatively during planning.

## AWS baseline and evidence gates

- Region us-east-1; configurable Terraform. Go Lambda behind HTTP API; separate Better Auth TypeScript Lambda. Same workspace origin via CloudFront paths for static web, Go API and auth; Astro marketing deploys separately when due. No domain purchase required for local work.
- Aurora Serverless v2 PostgreSQL is the selected target, conditional on $100/month full-system estimate/benchmark. Use PostgreSQL SQL/driver adapters; pgvector deferred. Start with bounded direct DB connections and reserved Lambda concurrency; choose proxy only if measured connection pressure warrants its cost and auto-pause tradeoff. Version/minimum capacity, resume latency and private network design must be verified in Q11 before provision.
- AppSync Events is selected. Native WebSockets locally; browser/server adapters translate protocols. Application JWT via Lambda authorizer and participant-scoped channel access; server IAM publishing.
- SQS cloud execution dispatch, separate from realtime. PostgreSQL job/outbox admission is durable; dispatcher relays to SQS with retries and periodic reconciliation. Queue messages identify a job; application lease/fencing remains authoritative so duplicates cannot bypass busy/score rules.
- gVisor Linux EC2 runner pool target; host controller consumes queue/suite/source storage and invokes restricted internal application commands. Sandboxes receive no host credentials/network/suite expected outputs. Source/suites in encrypted private object storage; upload/dispatch idempotent and immutable. Language-service hosting uses an independent container/process service, initially a dedicated Linux host; choose size/scaling from the capability/memory benchmark. Never co-locate language sessions with untrusted execution sandboxes.
- Private DB access, NAT/interface-endpoint/public-host egress, log retention, worker uptime, storage, backups and auth/email are included in cost modeling. Budget target is not evidence these products fit. Preserve local-first delivery if the estimate fails; escalate the concrete cost tradeoff rather than replacing user-selected products silently.

Sources checked during planning:

- [AppSync Events concepts](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-concepts.html): publish over HTTP/WebSocket and subscribe over WebSocket. Match authority remains application-owned.
- [Aurora scaling to zero](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html): engine/version support, open connections, resume behavior, and proxy interaction must be checked before selecting minimum capacity and connection strategy. Zero minimum capacity does not establish a total operating-cost estimate.

## Terraform and deployment

Separate environment state, least-privilege roles, encryption, private DB networking, runner boundaries, retention, budgets and observability. Version remote state with locking; separate bootstrap instructions avoid circular backend setup. Terraform modules: network, database, api/auth, realtime, execution, static-hosting, observability. Environment values contain configuration only, never committed secrets. Production plan and cost gate precede provisioning; no AWS credentials for local work/static validation. Pin providers/runtime/engine revisions at implementation.

GitHub Actions: path-aware Go tests/vet, `vp` check/build, disposable-service integration tests, Terraform fmt/validate; reviewed plan, locked forward-compatible migration, deployment, smoke test, rollback. OIDC roles, no long-lived AWS keys. GitHub protected production environment; ephemeral CI/staging by default, no always-on paid staging. Release migration must run once; app rollback cannot undo destructive data changes. Deploy backend compatible additions before frontend dependency. Preview credentials never grant production DB/queue access.

## Release evidence

Operating-defaults.md fixes workload, latency/queue targets, execution limits and retention. Capture no-AWS solo/1v1 E2E proof first. Cloud validates actual Cognito flow/JWT rotation/AppSync authorization/reconnect, Aurora connection/resume behavior, gVisor isolation, measured load/cost, alarms, backup restore, deployment/rollback. Report cold capacity startup separately from warm targets; auto-scaling-to-zero cannot be assumed to meet a five-second cold language session target. Public release waits for evidence; Terraform source validation alone does not certify runtime.
