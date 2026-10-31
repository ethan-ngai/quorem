import { assertRuntimeTestDatabase } from "./test-database.ts";
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
    assertRuntimeTestDatabase(url!);
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
    const peerRuntime = await startNodeRuntime(env);
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
      const sessionResponse = await fetch(`${base}/v1/session`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(sessionResponse.status).toBe(200);
      expect(await sessionResponse.json()).toMatchObject({
        kind: "account",
        mode: "managed",
        user: { displayName: user },
      });
      const capabilities = await fetch(`${base}/v1/capabilities`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toMatchObject({
        interviewConcurrency: 1,
        authorCustomQuestions: false,
      });
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
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) SELECT $1,b.user_id,'interviews.host','manual','fixture','fixture','fixture' FROM identity_bindings b WHERE b.issuer='http://127.0.0.1:8765' AND b.subject=$2",
        [crypto.randomUUID(), user],
      );
      const headers = {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "idempotency-key": `node-room-${crypto.randomUUID()}`,
      };
      const created = await fetch(`${base}/v1/interviews`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Node fanout",
          question: {
            problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
            language: "python",
          },
        }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const room = ((await created.json()) as { id: string }).id;
      const snapshot = await fetch(`${base}/v1/interviews/${room}`, { headers });
      const value = (await snapshot.json()) as { document: { epoch: string; source: string } };
      if (!peerRuntime.server.listening) await once(peerRuntime.server, "listening");
      const peerBase = `ws://127.0.0.1:${(peerRuntime.server.address() as AddressInfo).port}`;
      const peer = new WebSocket(
        `${peerBase}/v1/interviews/${room}/events`,
        ["quorem", `bearer.${bearer}`],
        { headers: { origin: "http://127.0.0.1:5173" } },
      );
      let resolveInitial!: () => void,
        resolveChanged!: () => void,
        changes = 0;
      const initial = new Promise<void>((resolve) => {
        resolveInitial = resolve;
      });
      const changed = new Promise<void>((resolve) => {
        resolveChanged = resolve;
      });
      peer.on("message", (data) => {
        const frame = JSON.parse(frameText(data)) as {
          receipt?: string;
          payload?: { type?: string };
        };
        if (frame.receipt) peer.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
        if (frame.payload?.type === "changed") {
          if (++changes === 1) resolveInitial();
          else resolveChanged();
        }
      });
      await Promise.race([
        initial,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("peer initial timeout")), 8000),
        ),
      ]);
      const push = await fetch(`${base}/v1/interviews/${room}/updates`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": `node-push-${crypto.randomUUID()}` },
        body: JSON.stringify({
          epoch: value.document.epoch,
          version: 0,
          updates: [{ clientID: "node", changes: [[0, "x"], value.document.source.length] }],
        }),
      });
      expect(push.status, await push.clone().text()).toBe(200);
      await Promise.race([
        changed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("peer fanout timeout")), 8000),
        ),
      ]);
      peer.close();
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
      await peerRuntime.close();
      await runtime.close();
      await pool.end();
    }
  },
  30000,
);
