/** @file verification-test-server.ts @description Disposable local Node verifier for native Worker tests. @module judging */
import { createServer } from "node:http";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { postgresInputReader } from "../inputs/read.ts";
import { postgresVerificationSource } from "./verification-source.ts";
import { nodeResultVerifier } from "../../../../../../runner/src/verification/verifier.ts";
import { verificationHandler } from "../../../../../../runner/src/verification/http.ts";
const url = process.env.QUOREM_RUNNER_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable test database required");
const parsed = new URL(url);
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
  !["/quorem_hono_engine_test", "/quorem_hono_runner_test"].includes(parsed.pathname) ||
  ["host", "hostaddr", "service"].some((key) => parsed.searchParams.has(key))
)
  throw new Error("Disposable test database required");
const pool = createNodePool({
  connectionString: url,
  max: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  onIdleError: () => {},
});
const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
const source = postgresVerificationSource(run),
  inputs = postgresInputReader(run);
const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const verify = nodeResultVerifier(
  {
    inputs,
    frozenCase: (id) => source.frozenCase(id),
    fieldPage: (id, field, offset) => source.fieldPage(id, field, offset),
    async putField(id, field, chunks) {
      let ordinal = 0;
      for await (const chunk of chunks) await source.putChunk(id, field, ordinal++, chunk);
    },
  },
  keys.privateKey,
);
const server = createServer(
  verificationHandler({ credential: new Uint8Array(32).fill(7), timeoutMs: 5000, verify }),
);
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const key = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64");
  process.stdout.write(JSON.stringify({ port: address.port, key }) + "\n");
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    }),
  );
