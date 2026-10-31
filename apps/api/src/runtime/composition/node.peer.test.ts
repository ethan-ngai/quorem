import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { startNodeRuntime } from "../node.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
it.skipIf(!url)(
  "uses socket peers for auth limits and rejects forged forwarding claims",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55575",
      "/quorem_hono_runtime_test",
    ]);
    const pool = createNodePool({
      connectionString: url!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    await pool.query("DELETE FROM quorem_auth.rate_limit");
    const runtime = await startNodeRuntime({
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://127.0.0.1:8765",
      AUTH_DATABASE_URL: url!,
      DATABASE_URL: url!,
      QUOREM_DATABASE_LISTEN_URL: url!,
      BETTER_AUTH_SECRET: "local-runtime-fixture-secret-32-characters",
      AUTH_INTERNAL_SECRET: "local-test-internal",
      QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MATCH_INVITE_KEY: "ab".repeat(32),
      EXECUTION_WAKE_PROVIDER: "sqs",
      SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
      PORT: "0",
      IDENTITY_MODE: "managed",
    });
    try {
      const port = (runtime.server.address() as AddressInfo).port;
      const call = (peer: string, forged: string) =>
        new Promise<number>((resolve, reject) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port,
              path: "/api/auth/get-session",
              localAddress: peer,
              headers: {
                "x-quorem-peer-ip": forged,
                "x-forwarded-for": forged,
                "cf-connecting-ip": forged,
              },
            },
            (res) => {
              res.resume();
              res.once("end", () => resolve(res.statusCode!));
            },
          );
          req.once("error", reject);
          req.end();
        });
      for (let i = 0; i < 30; i++) expect(await call("127.0.0.1", `198.51.100.${i + 1}`)).toBe(200);
      expect(await call("127.0.0.1", "203.0.113.1")).toBe(429);
    } finally {
      await runtime.close();
      await pool.end();
    }
  },
  30000,
);
