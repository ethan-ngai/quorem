# 37j local browser fixture

Issue #429. The fixture runs the actual Hono Node API/auth, Vite HMR, local SQS protocol endpoint, separate Node Docker runner and independent signed verifier. It uses Better Auth's existing local seed owner to create verified Alice and Bob with real password login. Entitlement grants use the canonical audited operator command. No production route, identity bypass, cloud credentials or Go runtime is involved.

Prerequisites: Node 24+, `vp` dependencies installed, a reachable Docker socket and the five local images `quorem-{python,java,typescript,ocaml,postgres}:local`. Provision a separate local PostgreSQL server on 127.0.0.1:55701 and create its disposable `quorem_hono_runtime_test` database. The command refuses any other host, port or database and resets that database under an exclusive advisory lock:

```sh
QUOREM_BROWSER_FIXTURE_DATABASE_URL='postgres://USER@127.0.0.1:55701/quorem_hono_runtime_test?sslmode=disable' \
QUOREM_TEST_DOCKER_SOCKET='/var/run/docker.sock' \
node --experimental-strip-types apps/api/src/runtime/composition/browser-fixture.ts
```

It reports the frontend and API origins and a 0600 local credentials file path; do not print or share that file. Frontend: http://127.0.0.1:5187/practice. API/auth: http://127.0.0.1:8765. Vite runs from the invoking checkout, proxying `/v1` and `/api/auth` to the API. The local SQS fixture acknowledges supported wake publication; continuous runner polling supplies local queue recovery. It does not model hosted SQS durability or Access.

Stop the fixture with SIGINT or SIGTERM. It stops Vite, asks the runner to drain and confirm shutdown, then closes the API/verifier, drops the disposable schemas and removes its temporary credentials and fence only after successful teardown. If runner teardown is uncertain it retains the database and fence and reports failure; it does not remove unrelated Docker containers. Missing prerequisites fail startup.

On the assigned checkout, using PostgreSQL 127.0.0.1:55701 and a local Docker daemon, both real seeded logins and session verification succeeded through Vite; a local workspace admission passed the SQS adapter, ran Python in the separate Docker runner, was checked by the independent verifier and returned a completed authorized result. Database guard unit tests and API typecheck passed. Browser interaction and cross-user match/interview flows are separate acceptance tests; hosted execution, queues and timing are not established by this fixture.
