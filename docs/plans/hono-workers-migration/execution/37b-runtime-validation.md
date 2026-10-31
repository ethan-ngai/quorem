# 37b: Composed runtime release validation

Issue #416. The release command requires a dedicated, disposable PostgreSQL database named `quorem_hono_runtime_test` on `127.0.0.1`, Node 24+, installed workspace dependencies, Wrangler/workerd, a local Docker socket and the already-built `quorem-python:local` image:

```sh
docker build -t quorem-python:local -f apps/runner/Dockerfile .
QUOREM_RUNTIME_TEST_URL='<disposable PostgreSQL URL>' \
QUOREM_TEST_DOCKER_SOCKET='<absolute Docker socket path>' \
vp -C apps/api exec node src/runtime/composition/run-validation.mjs
```

The command refuses missing prerequisites, unsupported database URLs, skipped or todo tests. It first verifies bootstrap and exclusive advisory locking, then resets only the named disposable database, applies both canonical migration ledgers, seeds the canonical catalog and a verified fixture operator, runs the Node and native workerd suites, and resets the fixture schemas after completion or a handled interruption. Abrupt process or host termination can require manual cleanup. Never point it at a running development database. The advisory lock coordinates this fixture command; it cannot stop unrelated clients from using the database.

The Node suite exercises real Node and Wrangler admission through Docker Python and the HTTP verifier. The workerd suite exercises native auth, HTTP, sockets, queue dispatch and mandatory Durable Object hibernation. Coverage is Python, not the other judge images. Match lifecycle and rule-event regressions remain separately covered by [37a](37a-lifecycle-regressions.md), using their own disposable database.

Local execution on isolated PostgreSQL port 55688: fixture bootstrap/locking 1/1, Node 14/14, workerd 3/3, no skips; fixture schemas were absent afterward. Missing DB and missing-image preflights failed before mutation. API typecheck and scoped lint passed. A handled SIGTERM also left both fixture schemas absent and no database sessions. The mandatory CI check and manual artifact workflow run the same command after building the Python sandbox image. Artifact configuration/gate tests passed 5/5; workflow YAML parsed locally. Hosted providers and deployment remain unverified.
