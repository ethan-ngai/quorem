# Distributed interview socket load

Work ledger: [#194](https://github.com/ethan-ngai/quorem/issues/194).

`TestDistributedInterviewLoad` exercises two independent Go HTTP API instances in one test process, real WebSocket clients, separate PostgreSQL fanout adapters, shared PostgreSQL presence leases, durable document transactions and interview outbox dispatch. JWT verification alone is replaced with an explicit synthetic identity verifier. It does not benchmark Better Auth, token issuance/rotation, DNS/TLS, a proxy/load balancer, judge execution, Cloudflare placement or autoscaling.

## Workload

- Configurable simultaneous client count; multiples of eight from 8 through 4,096. Default test suite skips it.
- Eight distinct authorized participants per room, alternating between replicas. The 2,000-client run uses 250 rooms and 1,000 sockets per replica.
- Bounded ramp: 16 concurrent connection attempts, each with a ten-second establishment/admission deadline. The first server frame confirms admission before the ramp records success.
- Every client continuously reads its socket, allowing protocol ping/pong and application heartbeats while idle.
- Eight rooms exercise edits concurrently. One participant pushes a real versioned CodeMirror change; all eight participants receive its document notice; the other replica's participant pulls and validates version one.
- The harness checks that an interviewee's snapshot excludes the private fixture; cursor reads and online presence agree across replicas; removing a member denies further socket access and removes their cursor.
- A default 35-second connected hold spans the 30-second shared lease TTL; every nonrevoked lease must remain live afterward. `QUOREM_TEST_LOAD_HOLD_SECONDS=0` selects a short smoke run (maximum hold 120 seconds). Final check rejects any unexpected authorized-client disconnect. Requested clients, successful ramp duration/rate, connection p50/p95, hold duration, delivery sample count, p50/p95 and configured capacity are logged without source, hidden data, credentials or actor/session IDs.

Delivery latency starts before the client sends `push` and ends when each client's reader receives the typed document notice. It includes the client write, authorization, document commit, outbox publication, replica subscription/authentication and socket delivery. Pull correctness is checked afterward; pull/rendering time is excluded from the latency statistic. This measures one edit per room while all clients stay connected, not sustained full-rate collaborative typing. There is no fragile millisecond pass/fail target: correctness work has bounded deadlines of ten seconds.

The actual `WithCapacity` middleware wraps both handlers with 32 ordinary HTTP slots and a socket limit of `clients/2 + 16` per replica. This is explicit load-test density above the production default of 512 sockets per replica. The event adapter uses the same per-replica socket capacity. Passing 2,000 clients with these settings does not validate the production replica count or limits.

## Reproduce

Use a separate disposable PostgreSQL database on the development Docker server. The harness refuses every database name except `quorem_load_194`. It applies current product migrations, inserts a unique synthetic namespace and deletes that namespace afterward. It never truncates tables or reads production credentials. Run it separately from other load/benchmark jobs.

```sh
docker exec quorem-postgres-1 createdb -U quorem quorem_load_194
# Enough descriptors for client and server halves of every local socket.
ulimit -n 16384
QUOREM_TEST_DATABASE_URL='postgres://quorem:quorem@localhost:54329/quorem_load_194?sslmode=disable' \
QUOREM_TEST_LOAD_CLIENTS=64 \
go test ./apps/api/internal/httpapi -run '^TestDistributedInterviewLoad$' -count=1 -v -timeout=6m

QUOREM_TEST_DATABASE_URL='postgres://quorem:quorem@localhost:54329/quorem_load_194?sslmode=disable' \
QUOREM_TEST_LOAD_CLIENTS=2000 \
go test ./apps/api/internal/httpapi -run '^TestDistributedInterviewLoad$' -count=1 -v -timeout=6m
```

The URL contains public local fixture credentials. Capture the final `local_distributed_load` line and record host/runtime details beside any claimed measurement. Repeated or interrupted runs use independent namespaces; an interrupted process can leave synthetic rows that should be removed only from this disposable database.

## Local result

Measured 2026-10-25 with the harness in this change. The 2,000-client hold used foundation `b98b5cf`; preliminary 8/64-client smoke runs used `98e43e6`. Host: Apple M5 Pro, 15 physical cores, 24 GiB memory, macOS arm64, Go 1.27.2; PostgreSQL 17.6 in local Docker. Both API instances and all clients share one Go process. Default API database pools have four connections per instance; each fanout adapter has a one-connection publish pool and a dedicated listener. This was a single observed run per row, not a median or an isolated-host benchmark.

| Clients / rooms | Hold | Connection ramp | Connection p50 / p95 | Notice p50 / p95 | Authorized disconnects |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8 / 1 | 0 s smoke | 29 ms | 27.9 / 29.0 ms | 12.2 / 12.5 ms | 0 |
| 64 / 8 | 0 s smoke | 70 ms | 16.0 / 33.9 ms | 21.2 / 25.9 ms | 0 |
| 2,000 / 250 | 35 s | 1,755 ms | 15.1 / 22.9 ms | 12.5 / 24.5 ms | 0 |

The 2,000-client run completed in 38.2 seconds, delivered 2,000 measured document notices, validated every cross-replica pull, and retained all 1,999 nonrevoked connection leases after the hold exceeded their 30-second TTL. One deliberate member revocation is excluded from the authorized-disconnect count. The test uses a 1,016-socket ceiling per instance, above the production 512 default. Delivery samples precede the idle hold; they do not measure sustained typing during lease-renewal bursts.

Separate real-PostgreSQL race regressions passed: eight simultaneous same-subject connection attempts across two presence instances admit exactly four leases; an expired lease loses its connection signal without deleting its replacement; forcibly terminating an isolated fanout listener closes old subscriptions and a new subscription receives notices after reconnect. These tests seed only their own lease/topic namespace and do not truncate data.

## Evidence boundaries

This is a local multi-instance PostgreSQL/socket correctness and connection-density harness. The two instances run in one process and share the host scheduler; cross-process failover is not measured. It is not evidence of a thousand-user production SLA, managed-provider capacity, scale-to-zero wake latency, judge throughput, or complete user interaction latency. Hosted workload validation must include actual identity, TLS/proxy hops, region placement, database connection budgets, sustained edits/cursors/submissions, deployment rollouts and reconnects under the intended replica policy.
