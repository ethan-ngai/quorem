import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../../../application/error.ts";
import type { LocalPrincipal } from "../../identity/model.ts";
import type { Notice } from "../dispatch/ports.ts";
import { parseSocketCommand } from "./parse.ts";
import { SocketSession } from "./session.ts";
const actor: LocalPrincipal = {
  kind: "local",
  userId: "alice",
  displayName: "Alice",
  admin: false,
  emailVerified: true,
  sessionId: "s",
  strongUntil: 0,
};
const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const turn = () => new Promise((r) => setTimeout(r, 0));
const notice = (version: string): Notice => ({
  id: version,
  aggregateId: "x",
  version,
  type: "interview.document",
  occurredAt: "",
});
describe("browser socket protocol", () => {
  it("keeps escaped raw nested push, rejects oversized and malformed JSON", () => {
    const raw = String.raw`{"id":"i","type":"push","key":"abcdefgh","push":{"epoch":"e","version":0,"updates":[{"clientID":"a","changes":[[0,"\u0061"]]}]}}`;
    expect(parseSocketCommand(raw).rawPush).toBe(
      String.raw`{"epoch":"e","version":0,"updates":[{"clientID":"a","changes":[[0,"\u0061"]]}]}`,
    );
    expect(() => parseSocketCommand('{"id":"a",')).toThrow();
    expect(() => parseSocketCommand("x".repeat(262145))).toThrow();
  });
  it("subscribes before snapshot and coalesces changes while loading", async () => {
    const sent: unknown[] = [],
      gate = defer<void>(),
      order: string[] = [];
    let onNotice!: (n: Notice) => void,
      reads = 0;
    const s = new SocketSession({
      mode: "match",
      transport: {
        send: async (frame) => {
          sent.push(JSON.parse(frame));
        },
        ping: async () => {},
        close: () => {},
      },
      security: {
        verify: async () => ({ principal: actor, binding: "test-grant" }),
        authorize: async () => "role-1",
      },
      subscription: {
        subscribe: async (f) => {
          order.push("subscribe");
          onNotice = f;
          return () => {};
        },
      },
      snapshot: {
        read: async () => {
          order.push("snapshot");
          reads++;
          if (reads === 1) {
            onNotice(notice("2"));
            onNotice(notice("3"));
            await gate.promise;
          }
          return { body: JSON.stringify({ version: String(reads) }), version: String(reads) };
        },
      },
    });
    const started = s.start();
    await turn();
    expect(order).toEqual(["subscribe", "snapshot"]);
    gate.resolve();
    await started;
    expect(reads).toBe(2);
    expect(sent).toEqual([{ version: "1" }, { version: "2" }]);
    s.close();
  });
  it("keeps heartbeat and advisory independent of slow document commands", async () => {
    const slow = defer<unknown>(),
      sent: Record<string, unknown>[] = [],
      pings: string[] = [],
      renewed: string[] = [];
    const s = new SocketSession({
      mode: "interview",
      transport: {
        send: async (frame) => {
          sent.push(JSON.parse(frame));
        },
        ping: async () => {
          pings.push("ping");
        },
        close: () => {},
      },
      security: {
        verify: async () => ({ principal: actor, binding: "test-grant" }),
        authorize: async () => "member",
      },
      subscription: { subscribe: async () => () => {} },
      renew: async () => {
        renewed.push("renew");
        return true;
      },
      commands: { execute: async (_p, c) => (c.type === "push" ? slow.promise : { ok: true }) },
    });
    await s.start();
    s.receive('{"id":"one","type":"push"}');
    await turn();
    s.receive('{"id":"two","type":"peers"}');
    await s.heartbeat();
    await turn();
    expect(pings).toHaveLength(1);
    expect(renewed).toHaveLength(1);
    expect(sent.some((x) => x.id === "two")).toBe(true);
    expect(sent.some((x) => x.id === "one")).toBe(false);
    slow.resolve({ ok: true });
    await turn();
    expect(sent.some((x) => x.id === "one")).toBe(true);
    s.close();
  });
  it("reauthorizes queued private output, closes on revocation and never caches failure", async () => {
    const gate = defer<void>(),
      sent: Record<string, unknown>[] = [],
      closed: number[] = [];
    let role = "staff",
      denied = false;
    const s = new SocketSession({
      mode: "match",
      transport: {
        send: async (frame) => {
          sent.push(JSON.parse(frame));
        },
        ping: async () => {},
        close: (code) => closed.push(code),
      },
      security: {
        verify: async () => ({ principal: actor, binding: "test-grant" }),
        authorize: async () => {
          if (denied) throw new ApplicationError("forbidden", "Denied", 403);
          return role;
        },
      },
      subscription: { subscribe: async () => () => {} },
      snapshot: {
        read: async () => {
          await gate.promise;
          return { body: JSON.stringify({ secret: role === "staff" }), version: "1" };
        },
      },
    });
    const start = s.start();
    await turn();
    role = "candidate";
    gate.resolve();
    await start;
    expect(sent).toEqual([{ secret: false }]);
    denied = true;
    await s.heartbeat();
    expect(closed).toEqual([1008]);
  });
  it("closes slow consumers once bounded pending output fills", async () => {
    const blocked = defer<void>(),
      closed: number[] = [];
    const s = new SocketSession({
      mode: "interview",
      transport: {
        send: async () => blocked.promise,
        ping: async () => {},
        close: (code) => closed.push(code),
      },
      security: {
        verify: async () => ({ principal: actor, binding: "test-grant" }),
        authorize: async () => "member",
      },
      subscription: { subscribe: async () => () => {} },
      commands: { execute: async () => ({}) },
    });
    void s.start();
    await turn();
    for (let i = 0; i < 20; i++) void s.heartbeat();
    await turn();
    expect(closed).toContain(1013);
    blocked.resolve();
  });
  it("closes instead of overtaking a timed out document mutation", async () => {
    vi.useFakeTimers();
    try {
      const blocked = defer<unknown>(),
        closed: number[] = [],
        calls: string[] = [];
      const s = new SocketSession({
        mode: "interview",
        transport: {
          send: async () => {},
          ping: async () => {},
          close: (code) => closed.push(code),
        },
        security: {
          verify: async () => ({ principal: actor, binding: "test-grant" }),
          authorize: async () => "member",
        },
        subscription: { subscribe: async () => () => {} },
        commands: {
          execute: async (_p, c) => {
            calls.push(c.id);
            return blocked.promise;
          },
        },
      });
      await s.start();
      s.receive('{"id":"one","type":"push"}');
      s.receive('{"id":"two","type":"push"}');
      await vi.advanceTimersByTimeAsync(5001);
      expect(closed).toEqual([1013]);
      expect(calls).toEqual(["one"]);
      blocked.resolve({});
    } finally {
      vi.useRealTimers();
    }
  });
});
