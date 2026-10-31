import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { createNodePool } from "@quorem/database/core";
import { frameText } from "../../adapters/events/fanout/common.ts";
import { startNodeRuntime } from "../node.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
it.skipIf(!url)(
  "serves real auth, catalog, workspace and authenticated socket over Node HTTP",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55575",
      "/quorem_hono_runtime_test",
    ]);
    const secret = "local-runtime-fixture-secret-32-characters";
    const env = {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://127.0.0.1:8765",
      AUTH_DATABASE_URL: url!,
      DATABASE_URL: url!,
      QUOREM_DATABASE_LISTEN_URL: url!,
      BETTER_AUTH_SECRET: secret,
      AUTH_INTERNAL_SECRET: "local-test-internal",
      QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MATCH_INVITE_KEY: "ab".repeat(32),
      EXECUTION_WAKE_PROVIDER: "sqs",
      SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
      PORT: "0",
      IDENTITY_MODE: "managed",
      SOCKET_HEARTBEAT_MS: "1000",
    };
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const user = `runtime-${crypto.randomUUID()}`,
      session = crypto.randomUUID(),
      token = crypto.randomUUID();
    await pool.query(
      'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,NOW(),NOW())',
      [user, `${user}@example.test`],
    );
    await pool.query(
      'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
      [session, token, user],
    );
    const runtime = await startNodeRuntime(env);
    try {
      if (!runtime.server.listening) await once(runtime.server, "listening");
      const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
      const signature = createHmac("sha256", secret).update(token).digest("base64");
      const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
      const auth = await fetch(`${base}/api/auth/token`, {
        headers: { cookie, origin: "http://127.0.0.1:5173" },
      });
      expect(auth.status).toBe(200);
      const bearer = ((await auth.json()) as { token: string }).token;
      const catalog = await fetch(`${base}/v1/problems`);
      expect(catalog.status).toBe(200);
      expect(catalog.headers.get("x-request-id")).toBeTruthy();
      const workspace = await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
          language: "python",
        }),
      });
      expect(workspace.status).toBe(201);
      const socket = new WebSocket(
        `${base.replace("http:", "ws:")}/v1/memberships/events`,
        ["quorem", `bearer.${bearer}`],
        { headers: { origin: "http://127.0.0.1:5173" } },
      );
      socket.on("message", (data) => {
        const frame = JSON.parse(frameText(data)) as { receipt?: string };
        if (frame.receipt) socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
      });
      await once(socket, "open");
      const closed = once(socket, "close");
      await pool.query('DELETE FROM quorem_auth."session" WHERE id=$1', [session]);
      const revoked = await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
          language: "python",
        }),
      });
      expect(revoked.status).toBe(401);
      const [code] = await Promise.race([
        closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("socket revocation timeout")), 8000),
        ),
      ]);
      expect(code).toBe(1008);
    } finally {
      await runtime.close();
      await pool.end();
    }
  },
  30000,
);
