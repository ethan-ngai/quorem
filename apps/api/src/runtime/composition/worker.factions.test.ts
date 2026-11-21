/// <reference types="@cloudflare/vitest-plugin/types" />
/** @file worker.factions.test.ts @description Private team collaboration through the production Worker composition. @module runtime */
import { env, SELF } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
import { expect, it } from "vitest";
import { assertRuntimeTestDatabase } from "./test-database.ts";

it("delivers edits and votes only to teammates and catches up after reconnect", async () => {
  const bindings = env as unknown as { DB: { connectionString: string }; DATABASE_CHECK: string };
  assertRuntimeTestDatabase(bindings.DATABASE_CHECK);
  const origin = "http://127.0.0.1:8765";
  const match = crypto.randomUUID();
  const workspaces = [crypto.randomUUID(), crypto.randomUUID()];
  const epochs = [crypto.randomUUID(), crypto.randomUUID()];
  const accounts = [1, 1, 2].map((team) => ({
    id: crypto.randomUUID(),
    session: crypto.randomUUID(),
    token: crypto.randomUUID(),
    team,
  }));
  const publication = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
  await withWorkerConnection(
    bindings.DB.connectionString,
    { connectionTimeoutMs: 2000, lifetimeMs: 10000 },
    (scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        for (const account of accounts) {
          await tx.execute(
            sql`INSERT INTO users(id,display_name) VALUES(${account.id},${account.id})`,
          );
          await tx.execute(
            sql`INSERT INTO identity_bindings(issuer,subject,user_id) VALUES(${origin},${account.id},${account.id})`,
          );
          await tx.execute(
            sql`INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(${account.id},${account.id},${account.id + "@example.test"},true,NOW(),NOW())`,
          );
          await tx.execute(
            sql`INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES(${account.session},${account.token},${account.id},NOW()+interval '1 hour',NOW(),NOW())`,
          );
        }
        await tx.execute(sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,mode,difficulties,publication_id,started_at,deadline,rules)
        VALUES(${match}::uuid,${accounts[0].id},${match},NOW()+interval '1 hour',30,'active','factions',ARRAY['easy'],${publication}::uuid,NOW(),NOW()+interval '30 minutes','{}')`);
        for (const [offset, owner] of [accounts[0], accounts[2]].entries()) {
          await tx.execute(sql`INSERT INTO workspaces(id,owner_id,publication_id,language,kind,match_id,team)
          VALUES(${workspaces[offset]}::uuid,${owner.id},${publication}::uuid,'python','match',${match}::uuid,${owner.team})`);
          await tx.execute(sql`INSERT INTO match_teams(match_id,team,workspace_id,source,document_epoch)
          VALUES(${match}::uuid,${owner.team},${workspaces[offset]}::uuid,'abc',${epochs[offset]}::uuid)`);
        }
        for (const [index, actor] of accounts.entries())
          await tx.execute(sql`INSERT INTO match_participants(match_id,owner_id,seat,team,workspace_id,competitor_id)
          VALUES(${match}::uuid,${actor.id},${index + 1},${actor.team},${workspaces[actor.team - 1]}::uuid,${"team:" + actor.team})`);
      }),
  );
  const sign = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-runtime-fixture-secret-32-characters"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const cookies = await Promise.all(
    accounts.map(async ({ token }) => {
      const signature = await crypto.subtle.sign("HMAC", sign, new TextEncoder().encode(token));
      return `better-auth.session_token=${encodeURIComponent(token + "." + btoa(String.fromCharCode(...new Uint8Array(signature))))}`;
    }),
  );
  const sockets: WebSocket[] = [];
  const url = `${origin}/v1/matches/${match}/team`;
  const upgrade = (actor: number, team: number) =>
    SELF.fetch(`${url}/${team}/events`, {
      headers: {
        origin,
        cookie: cookies[actor],
        upgrade: "websocket",
        "sec-websocket-protocol": "quorem-hibernate",
      },
    });
  async function connect(actor: number, team: number) {
    const response = await upgrade(actor, team);
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    sockets.push(socket);
    const frames: unknown[] = [];
    socket.addEventListener("message", (event: MessageEvent) => {
      if (event.data === "quorem:pong") {
        frames.push(event.data);
        return;
      }
      const { receipt, payload } = JSON.parse(String(event.data));
      socket.send(JSON.stringify({ type: "receipt", id: receipt }));
      frames.push(payload);
    });
    socket.accept();
    await expect.poll(() => frames).toContainEqual({ type: "changed" });
    frames.length = 0;
    return { socket, frames };
  }
  try {
    expect((await upgrade(0, 2)).status).toBe(404);
    const author = await connect(0, 1);
    const teammate = await connect(1, 1);
    const opponent = await connect(2, 2);
    opponent.socket.send("quorem:ping");
    await expect.poll(() => opponent.frames).toEqual(["quorem:pong"]);
    const edit = {
      epoch: epochs[0],
      version: 0,
      updates: [{ clientID: "author", changes: [3, [0, "!"]] }],
    };
    author.socket.send(
      JSON.stringify({ type: "push", id: "edit", key: "fixture-edit", push: edit }),
    );
    await expect
      .poll(() => author.frames)
      .toContainEqual({
        type: "response",
        id: "edit",
        value: { epoch: epochs[0], version: 1, updates: edit.updates },
      });
    await expect
      .poll(() => teammate.frames)
      .toContainEqual({ type: "changed", kind: "team.document" });
    teammate.socket.close();
    const newer = {
      epoch: epochs[0],
      version: 1,
      updates: [{ clientID: "author", changes: [4, [0, "?"]] }],
    };
    author.socket.send(
      JSON.stringify({ type: "push", id: "newer", key: "fixture-newer", push: newer }),
    );
    await expect
      .poll(() => author.frames)
      .toContainEqual({
        type: "response",
        id: "newer",
        value: { epoch: epochs[0], version: 2, updates: newer.updates },
      });
    const recovered = await connect(1, 1);
    recovered.socket.send(
      JSON.stringify({ type: "pull", id: "catch-up", epoch: epochs[0], version: 0 }),
    );
    await expect
      .poll(() => recovered.frames)
      .toContainEqual({
        type: "response",
        id: "catch-up",
        value: { epoch: epochs[0], version: 2, updates: [...edit.updates, ...newer.updates] },
      });
    const vote = await SELF.fetch(`${url}/propose`, {
      method: "POST",
      headers: {
        origin,
        cookie: cookies[0],
        "content-type": "application/json",
        "idempotency-key": "fixture-vote",
      },
      body: JSON.stringify({ action: { kind: "concede" } }),
    });
    expect(vote.status, await vote.clone().text()).toBe(200);
    await expect
      .poll(() => recovered.frames)
      .toContainEqual({ type: "changed", kind: "team.snapshot" });
    expect(opponent.frames).toEqual(["quorem:pong"]);
  } finally {
    for (const socket of sockets) socket.close();
  }
});
