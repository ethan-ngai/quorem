/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
it("runs native auth, catalog, workspace and durable socket through composition", async () => {
  const db = (env as unknown as { DB: { connectionString: string } }).DB.connectionString;
  const parsed = new URL((env as unknown as { DATABASE_CHECK: string }).DATABASE_CHECK);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55575",
    "/quorem_hono_runtime_test",
  ]);
  const user = `worker-${crypto.randomUUID()}`,
    session = crypto.randomUUID(),
    token = crypto.randomUUID(),
    secret = "local-runtime-fixture-secret-32-characters";
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(db, { connectionTimeoutMs: 2000, lifetimeMs: 10000 }, fn);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(${user},${user},${user + "@example.test"},true,NOW(),NOW())`,
      );
      await tx.execute(
        sql`INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES(${session},${token},${user},NOW()+interval '1 hour',NOW(),NOW())`,
      );
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
  );
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...signed))}`)}`;
  const auth = await SELF.fetch("http://127.0.0.1:8765/api/auth/token", {
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  expect(auth.status).toBe(200);
  const bearer = ((await auth.json()) as { token: string }).token;
  const catalog = await SELF.fetch("http://127.0.0.1:8765/v1/problems");
  expect(catalog.status).toBe(200);
  const workspace = await SELF.fetch("http://127.0.0.1:8765/v1/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      language: "python",
    }),
  });
  expect(workspace.status).toBe(201);
  const upgraded = await SELF.fetch("http://127.0.0.1:8765/v1/memberships/events", {
    headers: {
      upgrade: "websocket",
      origin: "http://127.0.0.1:5173",
      "sec-websocket-protocol": `quorem,bearer.${bearer}`,
    },
  });
  expect(upgraded.status).toBe(101);
  upgraded.webSocket!.accept();
  upgraded.webSocket!.close();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(sql`DELETE FROM quorem_auth."session" WHERE id=${session}`),
    ),
  );
  const revoked = await SELF.fetch("http://127.0.0.1:8765/v1/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      language: "python",
    }),
  });
  expect(revoked.status).toBe(401);
});
