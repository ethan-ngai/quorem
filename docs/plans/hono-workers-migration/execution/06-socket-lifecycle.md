# Worker PostgreSQL socket lifecycle

`pg-cloudflare` 1.4.1 closes its Cloudflare socket while `_listen()` awaits a read. workerd rejects that read after `client.end()`; pg forwards the error after its caller's cleanup listener is removed. Native Vitest reproduced five unhandled rejections for five successful scoped queries, before isolate shutdown. Wrangler's HTTP fixture appeared clean but did not establish that there was no unhandled rejection.

The pinned package patch adapts both commits of upstream [node-postgres PR 3806](https://github.com/brianc/node-postgres/pull/3806), addressing [issue 3805](https://github.com/brianc/node-postgres/issues/3805): reads cancelled by explicit close or already-reported peer close stop the loop; other read failures still propagate. The patch covers published TypeScript, CommonJS runtime and declarations. Its ESM entry delegates to the patched CommonJS file. No `pg` client error suppression, transport replacement or TLS fallback is added. Remove the patch after an upstream release includes the fix and the lifecycle tests pass.

Validation used PostgreSQL 17.11 at loopback port 55455 in disposable `quorem_hono_socket_test`, workerd 1.20261023.1, Wrangler 4.156.0 and pg 8.16.3. With a local CA configured through `NODE_EXTRA_CA_CERTS`, `QUOREM_SOCKET_TEST_DATABASE_URL=<disposable URL> vp -C apps/api exec vitest run --config vitest.socket.config.ts` passed four native workerd tests: repeated clean closes, verified TLS (`sslmode=verify-full`, `pg_stat_ssl.ssl=true`), idle backend termination and active-query termination. A certificate not trusted by workerd failed the TLS handshake. No errors were suppressed. The existing Wrangler local-Hyperdrive fixture also passed success, rollback, timeout, exception, abort and cleanup with both `sslmode=disable` and `sslmode=verify-full`. `vp -C packages/database run typecheck` and `vp check --no-fmt` passed.

The TLS certificate and private key were generated only for the disposable local server; no credentials or keys are tracked. Hosted Hyperdrive, its TLS setup and production behavior remain unverified. Root lockfile regeneration is required when integrating this patch.

Reproduce the native suite from the repository root; use only a disposable database:

```sh
export SOCKET_FIXTURE_DIR="$(mktemp -d)"
export SOCKET_FIXTURE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-socket-lifecycle -e POSTGRES_PASSWORD="$SOCKET_FIXTURE_PASSWORD" -e POSTGRES_DB=quorem_hono_socket_test -p 127.0.0.1:55455:5432 postgres:17
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$SOCKET_FIXTURE_DIR/ca.key" -out "$SOCKET_FIXTURE_DIR/ca.crt" -days 1 -subj '/CN=Quorem Socket Test CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -newkey rsa:2048 -nodes -keyout "$SOCKET_FIXTURE_DIR/server.key" -out "$SOCKET_FIXTURE_DIR/server.csr" -subj '/CN=localhost'
printf '%s\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' 'subjectAltName=DNS:localhost,IP:127.0.0.1' > "$SOCKET_FIXTURE_DIR/server.ext"
openssl x509 -req -in "$SOCKET_FIXTURE_DIR/server.csr" -CA "$SOCKET_FIXTURE_DIR/ca.crt" -CAkey "$SOCKET_FIXTURE_DIR/ca.key" -CAcreateserial -out "$SOCKET_FIXTURE_DIR/server.crt" -days 1 -extfile "$SOCKET_FIXTURE_DIR/server.ext"
docker cp "$SOCKET_FIXTURE_DIR/server.key" quorem-hono-socket-lifecycle:/var/lib/postgresql/data/server.key
docker cp "$SOCKET_FIXTURE_DIR/server.crt" quorem-hono-socket-lifecycle:/var/lib/postgresql/data/server.crt
docker exec -u root quorem-hono-socket-lifecycle chown postgres:postgres /var/lib/postgresql/data/server.key /var/lib/postgresql/data/server.crt
docker exec -u root quorem-hono-socket-lifecycle chmod 600 /var/lib/postgresql/data/server.key
docker exec quorem-hono-socket-lifecycle psql -U postgres -d quorem_hono_socket_test -c 'ALTER SYSTEM SET ssl = on'
docker restart quorem-hono-socket-lifecycle
export QUOREM_SOCKET_TEST_DATABASE_URL="postgresql://postgres:$SOCKET_FIXTURE_PASSWORD@127.0.0.1:55455/quorem_hono_socket_test"
NODE_EXTRA_CA_CERTS="$SOCKET_FIXTURE_DIR/ca.crt" vp -C apps/api exec vitest run --config vitest.socket.config.ts
docker rm -f quorem-hono-socket-lifecycle
rm -rf "$SOCKET_FIXTURE_DIR"
```

Wait for PostgreSQL readiness before setting SSL or running the suite. Install the patched dependency first using the regenerated workspace lockfile. For the Wrangler fixture, start `vp -C apps/api exec wrangler dev --local --config ../../packages/database/wrangler.test.jsonc --ip 127.0.0.1 --port 58736` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` set to the disposable URL (and `NODE_EXTRA_CA_CERTS` for `sslmode=verify-full`); run `vp -C packages/database run test:workers` separately.
