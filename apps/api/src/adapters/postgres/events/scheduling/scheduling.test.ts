import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { postgresDeadlines } from "./deadlines.ts";
import { prearmReceipts, consumePrearm } from "./prearm.ts";
import { retainBatch } from "./retention.ts";
import {
  drainDeadlines,
  activateDeadline,
} from "../../../../modules/events/scheduling/scheduling.ts";
const url = process.env.QUOREM_SCHEDULING_TEST_DATABASE_URL!;
const parsed = new URL(url);
if (parsed.port !== "55453" || parsed.pathname !== "/quorem_hono_scheduling_test")
  throw new Error("Disposable database required");
const pool = createNodePool({
  connectionString: url,
  max: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 5000,
  onIdleError: () => {},
});
const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
const receipts = prearmReceipts(run),
  store = postgresDeadlines(run);
const match = crypto.randomUUID();
beforeAll(async () => {
  await pool.query(
    `INSERT INTO users(id,display_name) VALUES ('scheduler-owner','Scheduler') ON CONFLICT(id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES ($1,'scheduler-owner',$2,clock_timestamp()-interval '1 minute',15,'waiting',ARRAY['easy'])`,
    [match, crypto.randomUUID()],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM matches WHERE id=$1", [match]);
  await pool.end();
});
describe("deadline scheduling with PostgreSQL", () => {
  it("uses database clock, pending generations and delegates all transitions", async () => {
    const due = await store.candidates(0, 1, 32);
    expect(due).toContainEqual({ id: match, generation: null });
    const hostClock = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      expect(await store.delay(0, 1)).toBe(0);
    } finally {
      hostClock.mockRestore();
    }
    await pool.query(
      "INSERT INTO match_reconciliation_pending(match_id,generation) VALUES ($1,7)",
      [match],
    );
    expect(await store.candidates(0, 1, 32)).toContainEqual({ id: match, generation: "7" });
    const called: string[] = [];
    await drainDeadlines(
      store,
      async (c) => {
        called.push(c.id);
      },
      0,
      1,
    );
    expect(called).toContain(match);
    expect((await pool.query("SELECT state FROM matches WHERE id=$1", [match])).rows[0].state).toBe(
      "waiting",
    );
  });
  it("keeps deadline and execution receipt ownership separate", async () => {
    const execution = prearmReceipts(run, "execution"),
      deadline = prearmReceipts(run, "deadline");
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      shard = 39;
    try {
      await execution.create(a, shard);
      await deadline.create(b, shard);
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          consumePrearm(tx, a, shard, "execution"),
        ),
      );
      await deadline.acknowledge(a);
      expect(await execution.settle(a)).toBe("committed");
      expect(await deadline.settle(a)).toBe("abandoned");
      expect(await execution.list(shard)).toContain(a);
      expect(await execution.list(shard)).not.toContain(b);
      expect(await deadline.list(shard)).toContain(b);
      await expect(
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
            consumePrearm(tx, b, shard, "execution"),
          ),
        ),
      ).rejects.toThrow();
    } finally {
      await pool.query("DELETE FROM deadline_prearms WHERE id=ANY($1::uuid[])", [[a, b]]);
    }
  });
  it("locks receipt through commit; expiry cleanup cannot erase a delayed commit", async () => {
    const id = crypto.randomUUID();
    await receipts.create(id, 0);
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "UPDATE deadline_prearms SET committed_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    await expect(receipts.settle(id)).rejects.toThrow();
    await client.query("COMMIT");
    client.release();
    expect(await receipts.settle(id)).toBe("committed");
    await receipts.acknowledge(id);
    expect(await receipts.settle(id)).toBe("abandoned");
    const stale = crypto.randomUUID();
    await receipts.create(stale, 0);
    await pool.query(
      "UPDATE deadline_prearms SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [stale],
    );
    expect(await receipts.settle(stale)).toBe("abandoned");
    await expect(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          consumePrearm(tx, stale, 0),
        ),
      ),
    ).rejects.toThrow();
  });
  it("prearms before activation and consumes a fenced operation exactly once", async () => {
    const calls: string[] = [];
    let op = "";
    await activateDeadline(
      receipts,
      {
        prearm: async () => {
          calls.push("prearm");
        },
        wake: async () => {
          calls.push("wake");
        },
      },
      0,
      async (id) => {
        op = id;
        calls.push("activate");
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
            consumePrearm(tx, id, 0),
          ),
        );
      },
    );
    expect(calls).toEqual(["prearm", "activate", "wake"]);
    expect(await receipts.settle(op)).toBe("committed");
    await expect(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          consumePrearm(tx, op, 0),
        ),
      ),
    ).rejects.toThrow();
    await receipts.acknowledge(op);
  });
  it("deletes only expired published notices in bounded batches", async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids)
      await pool.query(
        "INSERT INTO membership_outbox(id,participant_id,occurred_at,published_at) VALUES ($1,$2,clock_timestamp()-interval '8 days',clock_timestamp())",
        [id, crypto.randomUUID()],
      );
    const unpublished = crypto.randomUUID();
    await pool.query(
      "INSERT INTO membership_outbox(id,participant_id,occurred_at) VALUES ($1,$2,clock_timestamp()-interval '8 days')",
      [unpublished, crypto.randomUUID()],
    );
    await retainBatch(run, 2);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM membership_outbox WHERE id=ANY($1::uuid[])", [ids]))
          .rows[0].count,
      ),
    ).toBe(1);
    await retainBatch(run, 2);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM membership_outbox WHERE id=$1", [unpublished]))
          .rows[0].count,
      ),
    ).toBe(1);
  });
});

describe("independent repair", () => {
  it("wakes every shard and runs maintenance even when a wake fails", async () => {
    const { scheduledRepair } = await import("../../../scheduling/shells.ts");
    const seen: number[] = [];
    let maintenance = false;
    await expect(
      scheduledRepair(
        {
          prearm: async () => {},
          wake: async (shard) => {
            seen.push(shard);
            if (shard === 1) throw new Error("unavailable");
          },
        },
        3,
        async () => {
          maintenance = true;
        },
      ),
    ).rejects.toThrow("Scheduled repair failed");
    expect(seen).toEqual([0, 1, 2]);
    expect(maintenance).toBe(true);
  });
  it("keeps an arrival wake when it races the final drain", async () => {
    const { ShardAlarm } = await import("../../../scheduling/coordinator.ts");
    let alarm: number | null = null;
    const values = new Map<string, unknown>();
    const storage: import("../../../scheduling/coordinator.ts").AlarmStorage = {
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T) {
        values.set(key, value);
      },
      async getAlarm() {
        return alarm;
      },
      async setAlarm(at: number) {
        alarm = at;
      },
      async transaction<T>(
        fn: (tx: import("../../../scheduling/coordinator.ts").AlarmStorage) => Promise<T>,
      ) {
        return fn(storage);
      },
    };
    let coordinator: InstanceType<typeof ShardAlarm>;
    coordinator = new ShardAlarm(storage, {
      shards: 1,
      receipts: {
        create: async () => {},
        settle: async () => "pending",
        acknowledge: async () => {},
        list: async () => [],
      },
      store: {
        candidates: async () => [],
        delay: async () => {
          await coordinator.wake(0);
          return null;
        },
      },
      reconcile: async () => {
        throw new Error("unexpected");
      },
    });
    await coordinator.wake(0);
    alarm = null;
    await coordinator.alarm();
    expect(alarm).not.toBeNull();
  });
});
