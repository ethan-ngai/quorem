/** @file conformance.ts @description Actual match and invitation socket contract. @module events */
import { expect } from "vitest";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import type { LocalPrincipal } from "../../../identity/model.ts";
import { normalizeSettings } from "../../../matches/lifecycle/model.ts";
import { matchLifecycle } from "../../../../adapters/postgres/matches/lifecycle/repository.ts";
import { matchInvitations } from "../../../../adapters/postgres/matches/invitations/repository.ts";
import { prearmReceipts } from "../../../../adapters/postgres/events/scheduling/prearm.ts";
import { SocketSession } from "../session.ts";
import { matchSocketSnapshot } from "../match.ts";
import type { Notice } from "../../dispatch/ports.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
export async function matchConformance(run: Run): Promise<void> {
  const user = `socket-host-${crypto.randomUUID()}`,
    actor: LocalPrincipal = {
      kind: "local",
      userId: user,
      displayName: "Host",
      admin: false,
      emailVerified: true,
      sessionId: user,
      strongUntil: 0,
    },
    key = new Uint8Array(32).fill(7);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name,kind) VALUES(${user},'Host','account')`,
      );
    }),
  );
  const lifecycle = matchLifecycle(run, {
      inviteKey: key,
      receipts: prearmReceipts(run),
      coordinator: { prearm: async () => {}, wake: async () => {} },
      shards: 1,
      guestCreation: true,
    }),
    invites = matchInvitations(run, key);
  const created = (await lifecycle.create(
    actor,
    crypto.randomUUID(),
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string; inviteUrl: string };
  let token = created.inviteUrl.slice("/invite/".length),
    notifier!: (n: Notice) => void;
  const sent: Record<string, unknown>[] = [],
    closed: number[] = [];
  const transport = {
    send: async (frame: string) => {
      const { receipt, payload } = JSON.parse(frame);
      sent.push(payload);
      queueMicrotask(() => socket.receive(JSON.stringify({ type: "receipt", id: receipt })));
    },
    ping: async () => {},
    close: (code: number) => {
      closed.push(code);
    },
  };
  const sub = {
    subscribe: async (f: (n: Notice) => void) => {
      notifier = f;
      return () => {};
    },
  };
  const socket = new SocketSession({
    mode: "match",
    transport,
    subscription: sub,
    security: {
      verify: async () => ({ principal: actor, binding: "grant" }),
      authorize: async (p) => {
        if (!p) throw new Error("missing");
        const value = (await lifecycle.read(p, created.id)) as { version: string };
        return value.version;
      },
    },
    snapshot: matchSocketSnapshot(created.id, lifecycle),
  });
  await socket.start();
  expect(sent[0]).toMatchObject({
    type: "match.updated",
    aggregateId: created.id,
    schemaVersion: 1,
  });
  const initial = sent[0].aggregateVersion;
  const memberId = `socket-member-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name,kind) VALUES(${memberId},'Member','account')`,
      );
    }),
  );
  const member: LocalPrincipal = { ...actor, userId: memberId, sessionId: memberId };
  await invites.join(member, crypto.randomUUID(), token);
  const memberClosed: number[] = [];
  const memberSocket = new SocketSession({
    mode: "match",
    transport: {
      send: async (frame) => {
        const { receipt } = JSON.parse(frame);
        queueMicrotask(() =>
          memberSocket.receive(JSON.stringify({ type: "receipt", id: receipt })),
        );
      },
      ping: async () => {},
      close: (code) => memberClosed.push(code),
    },
    subscription: { subscribe: async () => () => {} },
    security: {
      verify: async () => ({ principal: member, binding: "member-grant" }),
      authorize: async (p) => {
        if (!p) throw new Error("missing");
        const value = (await lifecycle.read(p, created.id)) as { version: string };
        return value.version;
      },
    },
    snapshot: matchSocketSnapshot(created.id, lifecycle),
  });
  await memberSocket.start();
  await lifecycle.mutate(member, created.id, crypto.randomUUID(), "leave", null);
  await memberSocket.heartbeat();
  expect(memberClosed).toEqual([1008]);

  const rotated = (await invites.rotate(actor, created.id, crypto.randomUUID())) as {
    inviteUrl: string;
  };
  notifier({
    id: crypto.randomUUID(),
    aggregateId: created.id,
    version: "0",
    type: "match.updated",
    occurredAt: new Date().toISOString(),
  });
  await tick();
  expect(sent.at(-1)?.aggregateVersion).not.toBe(initial);
  let inviteToken = rotated.inviteUrl.slice("/invite/".length);
  const inviteClosed: number[] = [],
    inviteFrames: unknown[] = [];
  const invite = new SocketSession({
    mode: "invite",
    transport: {
      send: async (frame) => {
        const { receipt, payload } = JSON.parse(frame);
        inviteFrames.push(payload);
        queueMicrotask(() => invite.receive(JSON.stringify({ type: "receipt", id: receipt })));
      },
      ping: async () => {},
      close: (code) => {
        inviteClosed.push(code);
      },
    },
    subscription: { subscribe: async () => () => {} },
    security: {
      verify: async () => ({ binding: "opaque-invite-grant" }),
      authorize: async () => {
        await invites.preview(inviteToken);
        return "invite";
      },
    },
  });
  await invite.start();
  expect(inviteFrames).toEqual([{ type: "changed" }]);
  const next = (await invites.rotate(actor, created.id, crypto.randomUUID())) as {
    inviteUrl: string;
  };
  await invite.heartbeat();
  expect(inviteClosed).toEqual([1008]);
  token = next.inviteUrl.slice("/invite/".length);
  inviteToken = token;
  const expired: number[] = [];
  const expiry = new SocketSession({
    mode: "invite",
    transport: {
      send: async (frame) => {
        const { receipt } = JSON.parse(frame);
        queueMicrotask(() => expiry.receive(JSON.stringify({ type: "receipt", id: receipt })));
      },
      ping: async () => {},
      close: (code) => {
        expired.push(code);
      },
    },
    subscription: { subscribe: async () => () => {} },
    security: {
      verify: async () => ({ binding: "second-opaque-grant" }),
      authorize: async () => {
        await invites.preview(token);
        return "invite";
      },
    },
  });
  await expiry.start();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${created.id}::uuid`,
      );
    }),
  );
  await expiry.heartbeat();
  expect(expired).toEqual([1008]);
  await socket.heartbeat();
  await tick();
  expect(sent.at(-1)).toMatchObject({ type: "match.completed", aggregateId: created.id });
  for (let i = 0; i < 50 && !closed.includes(1000); i++) await tick();
  expect(closed).toContain(1000);
  socket.close();
  expiry.close();
}
