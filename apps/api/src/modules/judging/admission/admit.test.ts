import { describe, expect, it, vi } from "vitest";
import { admitWithRecovery } from "./admit.ts";

describe("prearmed execution admission", () => {
  it("requires a durable recovery alarm and prewake before committing", async () => {
    const calls: string[] = [];
    const receipts = {
      create: async () => {
        calls.push("receipt");
      },
      settle: async () => "pending" as const,
      acknowledge: async () => {},
      list: async () => [],
    };
    const coordinator = {
      prearm: async () => {
        calls.push("prearm");
      },
      wake: async () => {
        calls.push("wake");
      },
    };
    const publisher = {
      send: async () => {
        calls.push("prewake");
      },
    };
    await expect(
      admitWithRecovery({
        receipts,
        coordinator,
        publisher,
        shard: 1,
        commit: async () => {
          calls.push("commit");
          return 7;
        },
      }),
    ).resolves.toBe(7);
    expect(calls).toEqual(["receipt", "prearm", "prewake", "commit", "wake"]);
    calls.length = 0;
    const cause = new Error("offline");
    await expect(
      admitWithRecovery({
        receipts,
        coordinator,
        publisher: {
          send: async () => {
            throw cause;
          },
        },
        shard: 1,
        commit: async () => {
          calls.push("commit");
        },
      }),
    ).rejects.toMatchObject({
      code: "temporarily_unavailable",
      status: 503,
      message: "Judge unavailable",
      cause,
    });
    expect(calls).toEqual(["receipt", "prearm"]);
  });
  it("bounds a stalled prewake without opening the transaction", async () => {
    vi.useFakeTimers();
    try {
      let commits = 0;
      const receipts = {
        create: async () => {},
        settle: async () => "pending" as const,
        acknowledge: async () => {},
        list: async () => [],
      };
      const pending = admitWithRecovery({
        receipts,
        coordinator: { prearm: async () => {}, wake: async () => {} },
        publisher: { send: async () => new Promise<void>(() => {}) },
        shard: 0,
        commit: async () => {
          commits++;
        },
      });
      const assertion = expect(pending).rejects.toMatchObject({ code: "temporarily_unavailable" });
      await vi.advanceTimersByTimeAsync(2001);
      await assertion;
      expect(commits).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves authorization errors from commit", async () => {
    const { ApplicationError } = await import("../../../application/error.ts");
    const denied = new ApplicationError("forbidden", "Denied", 403);
    await expect(
      admitWithRecovery({
        receipts: {
          create: async () => {},
          settle: async () => "pending",
          acknowledge: async () => {},
          list: async () => [],
        },
        coordinator: { prearm: async () => {}, wake: async () => {} },
        publisher: { send: async () => {} },
        shard: 0,
        commit: async () => {
          throw denied;
        },
      }),
    ).rejects.toBe(denied);
  });
  it("does not replay an uncertain commit", async () => {
    let attempts = 0;
    const receipts = {
      create: async () => {},
      settle: async () => "pending" as const,
      acknowledge: async () => {},
      list: async () => [],
    };
    await expect(
      admitWithRecovery({
        receipts,
        coordinator: { prearm: async () => {}, wake: async () => {} },
        publisher: { send: async () => {} },
        shard: 0,
        commit: async () => {
          attempts++;
          throw new Error("unknown_commit");
        },
      }),
    ).rejects.toThrow("unknown_commit");
    expect(attempts).toBe(1);
  });
});
