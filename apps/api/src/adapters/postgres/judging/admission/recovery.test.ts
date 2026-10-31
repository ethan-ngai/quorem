import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { prearmReceipts, consumePrearm } from "../../events/scheduling/prearm.ts";
import {
  AdmissionRecovery,
  type AdmissionAlarmStorage,
} from "../../../../modules/judging/admission/recovery.ts";

const url = process.env.QUOREM_ADMISSION_TEST_DATABASE_URL;
describe.skipIf(!url)("execution receipt recovery", () => {
  const parsed = new URL(url ?? "postgres://127.0.0.1:55458/quorem_hono_admission_test");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.searchParams.has("host") ||
    parsed.pathname !== "/quorem_hono_admission_test" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    throw new Error("Disposable admission database required");
  const pool = createNodePool({
    connectionString: url!,
    max: 5,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  const deadline = prearmReceipts(run, "deadline"),
    execution = prearmReceipts(run, "execution");
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
  });
  afterAll(async () => {
    await pool.end();
  });
  it("rejects a receipt that expires while waiting for its row lock", async () => {
    const id = crypto.randomUUID();
    await execution.create(id, 7);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE deadline_prearms SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
        [id],
      );
      const waiting = run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          consumePrearm(tx, id, 7, "execution"),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("COMMIT");
      await expect(waiting).rejects.toThrow("prearm unavailable");
    } finally {
      client.release();
      await pool.query("DELETE FROM deadline_prearms WHERE id=$1", [id]);
    }
  });
  it("routes purposes and retains recovery across a delayed commit", async () => {
    let alarm: number | null = null;
    const data = new Map<string, unknown>();
    const tx = {
      get: async <T>(k: string) => data.get(k) as T | undefined,
      put: async <T>(k: string, v: T) => {
        data.set(k, v);
      },
      getAlarm: async () => alarm,
      setAlarm: async (n: number) => {
        alarm = n;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    };
    const storage: AdmissionAlarmStorage = { ...tx, transaction: async (fn) => fn(tx) };
    let dispatches = 0,
      unavailable = true;
    const actor = new AdmissionRecovery(storage, execution, async () => {
      dispatches++;
      if (unavailable) throw new Error("publish unavailable");
      return { pending: false };
    });
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await execution.create(a, 7);
    await deadline.create(b, 7);
    await actor.prearm(7);
    expect(await execution.list(7)).toContain(a);
    expect(await execution.list(7)).not.toContain(b);
    expect(await deadline.list(7)).toContain(b);
    expect(await deadline.settle(a)).toBe("abandoned");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE deadline_prearms SET committed_at=clock_timestamp() WHERE id=$1 AND purpose='execution'",
        [a],
      );
      await expect(actor.alarm()).rejects.toThrow();
      expect(alarm).not.toBeNull();
      await client.query("COMMIT");
      await deadline.acknowledge(a);
      expect(await execution.settle(a)).toBe("committed");
      await expect(actor.alarm()).rejects.toThrow("publish unavailable");
      expect(await execution.settle(a)).toBe("committed");
      expect(alarm).not.toBeNull();
      unavailable = false;
      await actor.alarm();
      expect(dispatches).toBe(2);
      expect(await execution.list(7)).not.toContain(a);
      expect(await deadline.list(7)).toContain(b);
      await expect(
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 1000 }, (tx) =>
            consumePrearm(tx, b, 7, "execution"),
          ),
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.query("DELETE FROM deadline_prearms WHERE id=ANY($1::uuid[])", [[a, b]]);
    }
  }, 10000);
});
