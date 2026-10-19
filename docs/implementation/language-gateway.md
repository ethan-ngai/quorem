# Go language gateway prototype

Issue [#70](https://github.com/ethan-ngai/quorem/issues/70). Python parity first; Java, TypeScript and OCaml intelligence remain [#69](https://github.com/ethan-ngai/quorem/issues/69). Their syntax highlighting and judging already work.

## Local behavior

`make dev` builds/runs `apps/language/cmd/language`, replacing the Node broker. `make language` runs it independently. `LANGUAGE_GATEWAY=node make dev` retains the previous broker for comparison. Both use the existing Python/basedpyright image. This moves orchestration to Go; the analyzer itself still uses Python/Node.

Browser → authenticated WebSocket → Go admission/framing → isolated engine stdin/stdout. `EngineFactory` keeps container creation outside session policy; an ECS or other worker adapter can replace Docker without changing admission rules.

- Managed ownership comes from the API's verified `/v1/session`, never the `user` query. Exact Origin check, bearer subprotocol, revalidation every 15 seconds. Development fixture identities require explicit opt-in and loopback.
- One engine per owner **within this gateway process**. Explicit takeover waits for teardown. Failed cleanup keeps its capacity reservation; reconnect can retry it.
- Default eight reserved sessions, configurable `LANGUAGE_MAX_SESSIONS` (1–256). Total connections (including pending upgrades) bounded to twice capacity before identity calls.
- Five-minute inactivity expiry, configurable `LANGUAGE_IDLE_TIMEOUT` using Go duration syntax. Incoming valid editor messages refresh activity.
- Two MiB messages, bounded framing headers and queue, method/document allowlist, output write deadline. Engines have no network, read-only root, unprivileged UID, one CPU limit, 512 MiB memory limit, bounded PIDs/tmpfs.
- Disconnect, startup failure, takeover, idle expiry and SIGTERM clean up containers. Health reports reserved sessions/capacity. Bind remains loopback; TLS ingress belongs in a reverse proxy.

## Validation and measurements

2026-10-19, local Apple Silicon/OrbStack; prebuilt cached image, four sessions with a short Python document importing `collections.Counter`:

| Observation                                  | Result                        |
| -------------------------------------------- | ----------------------------- |
| Go gateway RSS, four open sessions           | 16,176 KiB (~16 MiB)          |
| Engine memory after five seconds             | 94.91, 108.8, 96.1, 102.2 MiB |
| Sequential WebSocket-to-initialize responses | 249, 205, 205, 208 ms         |

Docker stats sampled idle after analysis. These measure neither peak analysis CPU/memory nor simultaneous cold starts; do not size production from them. The 512 MiB cap, rather than observed idle usage, bounds reserved memory: eight engines can consume 4 GiB plus gateway, OS, Docker and tmpfs overhead. An 8 GiB host is a starting experiment; CPU throughput still needs load testing.

Reproduce parity checks with an isolated fixture gateway (do not point fixture tests at managed preview auth):

```sh
go test -race ./apps/language/...
go build -o /tmp/quorem-language ./apps/language/cmd/language
LANGUAGE_ADDR=127.0.0.1:18081 QUOREM_DEV_IDENTITY=true /tmp/quorem-language
# Separate terminal; run these sequentially because both use fixture owner bob.
QUOREM_LANGUAGE_TEST=true QUOREM_LANGUAGE_TEST_URL=ws://127.0.0.1:18081/lsp QUOREM_LANGUAGE_GATEWAY_BINARY=/tmp/quorem-language vp run --filter @quorem/language test
QUOREM_LANGUAGE_TEST=true QUOREM_LANGUAGE_TEST_URL=ws://127.0.0.1:18081/lsp vp -C apps/web test src/features/editor/languageIntegration.test.ts
```

Go tests cover capacity, takeover, idle expiry, invalid protocol, managed identity/origin, failed startup, disconnect during startup, failed cleanup/recovery and shutdown. Real Docker tests cover completion, hover, signatures, diagnostics, repeated takeover/reopen and SIGTERM teardown. CI runs both the Go race tests and real engine/client checks.

## Deployment proposal (not provisioned)

Start with **one dedicated Linux worker host**, a Go binary managed by systemd, and Docker engines. Keep judge execution and identity/database credentials off this host. Terminate TLS at the existing ingress or a host reverse proxy; proxy `/lsp` to loopback port 8081 with WebSocket upgrade support. Configure API identity URL, exact web/auth origins, capacity, idle timeout, SIGTERM grace and proxy timeout deliberately. Provision through Terraform; GitHub Actions builds/publishes the pinned engine image and Go binary, then drains/restarts the service. No cloud infrastructure is added by this prototype.

An EC2 host fits an existing VPC/ALB; Lightsail is a simpler fixed-price pilot alternative if its networking limits fit. A single host is deliberately not highly available. A restart disconnects editors; the browser reconnects and sends its current draft.

The current Docker stdin/stdout adapter cannot simply move into Fargate. AWS does not provide the host Docker access needed for this pattern; privileged Docker-in-Docker is unsupported. An ECS/Fargate version needs `RunTask`/`StopTask`, private authenticated engine transport and lifecycle reconciliation behind `EngineFactory`. See [Fargate security](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html).

Before public deployment: host sandbox review (Docker alone is not a strong hostile-tenant boundary), image scanning, cleanup/reconciliation after SIGKILL/host failure, metrics/alerts, per-owner connection attempt throttling and burst/load tests. Before multiple gateway replicas: distributed owner leases/routing and fleet-wide quotas; this process-local registry cannot enforce one owner globally. Add these when moving beyond the single-host pilot.

## Cost model

Prices checked 2026-10-19; USD, Linux, US East examples, before taxes. Costs below are **incremental intelligence infrastructure**, excluding the existing API/auth/database/judge. Registered users do not determine cost; concurrent analyzers and their retained idle time do.

| Option                                    | Cost basis                                                                   | Practical interpretation                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single Lightsail host                     | $44/month: 8 GB, 2 vCPU, 160 GB SSD, included public IPv4/transfer allowance | ~$50–60/month pilot budget after a small logging/backup allowance; eight sessions is an unvalidated admission starting point, not eight dedicated CPUs                                 |
| EC2 host in existing VPC                  | Size/region dependent, plus disk/network/logging                             | Budget roughly $60–100/month for a small 8 GiB pilot; estimate rather than a quoted instance price. Burstable CPU credits can add cost or throttle; use measured load to select family |
| Future Fargate engine, 1 vCPU/2 GiB       | ~$0.04937/worker-hour, ~$36.04 continuously/month                            | Minimum memory at 1 vCPU is 2 GiB: more expensive than packing the current 512 MiB containers on a host                                                                                |
| Future Fargate gateway, 0.25 vCPU/0.5 GiB | ~$9.01/month continuously                                                    | Illustrative allocation; actual request capacity must be measured                                                                                                                      |
| Dedicated ALB                             | ~$16.43/month base + LCU + public IPv4/data charges                          | Reusing ingress avoids a second base fee; traffic can still add charges                                                                                                                |

Sources: [Lightsail bundles](https://aws.amazon.com/lightsail/pricing/), [EC2 billing](https://aws.amazon.com/ec2/pricing/on-demand/), [Fargate rates/configurations](https://aws.amazon.com/fargate/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).

Fargate calculation uses AWS's US East Linux/x86 example rates: $0.000011244/vCPU-second + $0.000001235/GiB-second. At 730 hours/month, five continuously reserved 1 vCPU/2 GiB workers plus one small gateway and a dedicated ALB cost approximately **$206/month before LCU, public IPs, networking and logs**. At 1,000 total worker-hours instead, engine compute is ~$49.37 plus the gateway/ingress. Image pull/start time and minimum billing count; cold-start latency and warm pools matter. A half-vCPU/1 GiB allocation halves compute cost but changes the local CPU cap and needs separate latency validation.

For the initial scale, use a bounded host pool and idle eviction. Saving a few MiB in the gateway matters much less than analyzer concurrency, idle retention and choosing packed hosts versus per-user Fargate tasks. Java/OCaml/TypeScript need their own measurements before extending these estimates.
