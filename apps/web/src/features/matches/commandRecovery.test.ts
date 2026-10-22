/** @file commandRecovery.test.ts @description Lost-response mutation and invitation recovery. @module matches */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pendingCreate,
  readInvite,
  readPendingCommand,
  recoverableCommand,
  rememberInvite,
} from "./commandRecovery";

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:5180" } });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("recoverable match commands", () => {
  it("retries a lost create response with the same key and frozen settings", async () => {
    const original = { difficulty: "hard" as const, durationMinutes: 45 as const };
    const sent: { payload: unknown; key: string }[] = [];
    const request = async (payload: typeof original, key: string) => {
      sent.push({ payload, key });
      if (sent.length === 1) throw new Error("Response lost");
      return "match";
    };
    await expect(recoverableCommand("alice", "create", original, request, true)).rejects.toThrow(
      "Response lost",
    );
    expect(pendingCreate("alice")?.payload).toEqual(original);
    await recoverableCommand("alice", "create", original, request, true);
    expect(sent[1]).toEqual(sent[0]);
    expect(readPendingCommand("alice", "create")).toBeUndefined();
  });
  it("keeps mutation retry keys and private invitation links scoped to the account", async () => {
    const keys: string[] = [];
    const failed = async (_body: { ready: boolean }, key: string): Promise<void> => {
      keys.push(key);
      throw new Error("offline");
    };
    await expect(
      recoverableCommand("alice", "ready:match", { ready: true }, failed),
    ).rejects.toThrow();
    await expect(
      recoverableCommand("bob", "ready:match", { ready: true }, failed),
    ).rejects.toThrow();
    await expect(
      recoverableCommand("alice", "ready:match", { ready: true }, failed),
    ).rejects.toThrow();
    expect(keys[0]).toBe(keys[2]);
    expect(keys[0]).not.toBe(keys[1]);
    rememberInvite("alice", {
      id: "private",
      inviteUrl: "http://localhost:5173/invite/secret",
      state: "waiting",
    });
    expect(readInvite("alice", "private")).toBe("http://localhost:5180/invite/secret");
    expect(readInvite("bob", "private")).toBeNull();
  });
  it.each(["http://localhost:5180", "https://quorem.example"])(
    "resolves new and legacy invitations on %s after reload",
    (origin) => {
      vi.stubGlobal("window", { location: { origin } });
      for (const saved of ["/invite/secret", "http://localhost:5173/invite/secret"]) {
        localStorage.setItem("quorem.match-invite.v1:alice:private", saved);
        expect(readInvite("alice", "private")).toBe(`${origin}/invite/secret`);
      }
    },
  );
  it("starts a new key when readiness intent changes", async () => {
    const keys: string[] = [];
    const request = async (_body: { ready: boolean }, key: string): Promise<void> => {
      keys.push(key);
      throw new Error("offline");
    };
    await expect(
      recoverableCommand("bob", "ready:changed", { ready: true }, request),
    ).rejects.toThrow();
    await expect(
      recoverableCommand("bob", "ready:changed", { ready: false }, request),
    ).rejects.toThrow();
    expect(keys[0]).not.toBe(keys[1]);
  });
});
