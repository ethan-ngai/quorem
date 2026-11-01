import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { listenForNotices } from "./listener.ts";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { postgresDispatch, recoverExecutionIntents, insertExecutionIntent } from "./dispatch.ts";
import {
  admitWithRequiredWake,
  consumeWake,
  dispatchBatch,
  requiredPrewake,
} from "../../../modules/events/dispatch/dispatch.ts";
const url = process.env.QUOREM_DISPATCH_TEST_DATABASE_URL;
describe.skipIf(!url)("durable dispatch on disposable PostgreSQL", () => {
  it("recovers failed publication, contention and expired claims without stale acknowledgement", async () => {
    const parsed = new URL(url!);
    expect(parsed.port).toBe("55452");
    expect(parsed.pathname).toBe("/quorem_hono_dispatch_test");
    const pool = createNodePool({
      connectionString: url!,
      max: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    try {
      const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 5000 }, fn);
      const store = postgresDispatch(run);
      const id = crypto.randomUUID();
      await pool.query("INSERT INTO membership_outbox(id,participant_id) VALUES ($1,$2)", [
        id,
        crypto.randomUUID(),
      ]);
      const first = await store.claim("membership", 1, 1000);
      expect(first[0]?.id).toBe(id);
      expect(await store.pending("membership")).toBe(true);
      expect(await store.claim("membership", 1, 1000)).toHaveLength(0);
      await pool.query(
        "UPDATE membership_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      const second = await store.claim("membership", 1, 1000);
      expect(second).toHaveLength(1);
      expect(await store.acknowledge(first[0]!)).toBe(false);
      expect(await store.acknowledge(second[0]!)).toBe(true);
      const locked = crypto.randomUUID();
      const connection = await pool.connect();
      await connection.query("BEGIN");
      await connection.query("INSERT INTO membership_outbox(id,participant_id) VALUES ($1,$2)", [
        locked,
        crypto.randomUUID(),
      ]);
      expect(await store.claim("membership", 1, 1000)).toHaveLength(0);
      await connection.query("COMMIT");
      connection.release();
      expect((await store.claim("membership", 1, 1000))[0]?.id).toBe(locked);
      await pool.query(
        "UPDATE membership_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [locked],
      );
      const recovered = (await store.claim("membership", 1, 1000))[0]!;
      expect(await store.acknowledge(recovered)).toBe(true);
      const next = crypto.randomUUID();
      await pool.query("INSERT INTO membership_outbox(id,participant_id) VALUES ($1,$2)", [
        next,
        crypto.randomUUID(),
      ]);
      await expect(
        dispatchBatch(
          store,
          {
            publish: async () => {
              throw new Error("network");
            },
          },
          { send: async () => {} },
          "membership",
          1,
          1000,
        ),
      ).rejects.toThrow("network");
      await pool.query(
        "UPDATE membership_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [next],
      );
      let count = 0;
      const result = await dispatchBatch(
        store,
        {
          publish: async () => {
            count++;
          },
        },
        { send: async () => {} },
        "membership",
        1,
        1000,
      );
      expect(result.pending).toBe(false);
      expect(count).toBe(1);
      const arrival = crypto.randomUUID();
      await pool.query("INSERT INTO membership_outbox(id,participant_id) VALUES ($1,$2)", [
        arrival,
        crypto.randomUUID(),
      ]);
      const other = crypto.randomUUID();
      const continued = await dispatchBatch(
        store,
        {
          publish: async () => {
            await pool.query("INSERT INTO membership_outbox(id,participant_id) VALUES ($1,$2)", [
              other,
              crypto.randomUUID(),
            ]);
          },
        },
        { send: async () => {} },
        "membership",
        1,
        1000,
      );
      expect(continued.pending).toBe(true);
      const after = (await store.claim("membership", 1, 1000))[0]!;
      expect(after.id).toBe(other);
      expect(await store.acknowledge(after)).toBe(true);
    } finally {
      await pool.end();
    }
  });
  it("uses PostgreSQL notifications as an acceleration hint", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    try {
      let resolveWake: () => void = () => {};
      const signaled = new Promise<void>((resolve) => {
        resolveWake = resolve;
      });
      const close = await listenForNotices(url!, resolveWake, () => {});
      try {
        await pool.query("NOTIFY quorem_membership_outbox");
        await Promise.race([
          signaled,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("listener timeout")), 1000),
          ),
        ]);
      } finally {
        await close();
      }
    } finally {
      await pool.end();
    }
  });
  it("repairs an exhausted wake for an unfinished durable job", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const user = `fixture-${crypto.randomUUID()}`,
      problem = crypto.randomUUID(),
      version = crypto.randomUUID(),
      workspace = crypto.randomUUID(),
      submission = crypto.randomUUID(),
      job = crypto.randomUUID(),
      intent = crypto.randomUUID();
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [
        problem,
        `fixture-${problem}`,
      ]);
      await pool.query(
        "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','', '{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'')",
        [version, problem],
      );
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
        [version],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspace, user, version],
      );
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]'::jsonb)",
        [submission, user, workspace],
      );
      const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 5000 }, fn);
      const store = postgresDispatch(run);
      const wakes: import("../../../modules/events/dispatch/ports.ts").Wake[] = [];
      const transport = {
        send: async (wake: import("../../../modules/events/dispatch/ports.ts").Wake) => {
          wakes.push(wake);
        },
      };
      await requiredPrewake(transport, job, Date.now() + 5000);
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
          await tx.execute(
            sql`INSERT INTO execution_jobs(id,submission_id) VALUES(${job}::uuid,${submission}::uuid)`,
          );
          await insertExecutionIntent(tx, intent, job);
          await consumeWake(wakes[0]!, transport, async () => ({
            pending: await store.pending("execution"),
          }));
          expect(wakes).toHaveLength(2);
        }),
      );
      let published = 0;
      await expect(
        dispatchBatch(
          store,
          { publish: async () => {} },
          {
            send: async () => {
              published++;
              throw new Error("lost ack");
            },
          },
          "execution",
          64,
          1000,
        ),
      ).rejects.toThrow("lost ack");
      expect(await store.pending("execution")).toBe(true);
      await pool.query(
        "UPDATE execution_dispatch_intents SET dispatch_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [intent],
      );
      await dispatchBatch(
        store,
        { publish: async () => {} },
        {
          send: async () => {
            published++;
          },
        },
        "execution",
        64,
        1000,
      );
      expect(published).toBe(2);
      await pool.query(
        "UPDATE execution_dispatch_intents SET delivered_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
        [intent],
      );
      expect(await recoverExecutionIntents(run)).toBeGreaterThanOrEqual(1);
      const claim = (await store.claim("execution", 64, 1000)).find((c) => c.id === intent)!;
      expect(claim.jobId).toBe(job);
      expect(await store.acknowledge(claim)).toBe(true);
      await pool.query(
        "UPDATE execution_dispatch_intents SET delivered_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
        [intent],
      );
      await pool.query("UPDATE execution_jobs SET finished=true WHERE id=$1", [job]);
      await recoverExecutionIntents(run);
      expect(
        (
          await pool.query(
            "SELECT delivered_at IS NOT NULL AS done FROM execution_dispatch_intents WHERE id=$1",
            [intent],
          )
        ).rows[0].done,
      ).toBe(true);
    } finally {
      await pool.end();
    }
  });
  it("prewake failure prevents admission and postcommit failure preserves its result", async () => {
    let admitted = false;
    await expect(
      admitWithRequiredWake(
        {
          send: async () => {
            throw new Error("offline");
          },
        },
        "job-1",
        Date.now() + 5000,
        async () => {
          admitted = true;
        },
      ),
    ).rejects.toThrow("offline");
    expect(admitted).toBe(false);
    let calls = 0;
    const value = await admitWithRequiredWake(
      {
        send: async () => {
          if (++calls > 1) throw new Error("offline");
        },
      },
      "job-1",
      Date.now() + 5000,
      async () => "committed",
    );
    expect(value).toBe("committed");
  });
  it("schedules a durable continuation for an early admission wake and propagates send failures", async () => {
    const sent: unknown[][] = [];
    const publisher = {
      send: async (...args: unknown[]) => {
        sent.push(args);
      },
    };
    await requiredPrewake(publisher, "job-1", Date.now() + 5000);
    await consumeWake(
      sent[0]![0] as never,
      publisher,
      async () => ({ pending: false }),
      Date.now(),
    );
    expect(sent).toHaveLength(2);
    await consumeWake(
      sent[0]![0] as never,
      publisher,
      async () => ({ pending: false }),
      Date.now(),
    );
    expect(sent).toHaveLength(3); // Lost acknowledgement safely republishes continuation.
    await consumeWake(
      sent[1]![0] as never,
      publisher,
      async () => ({ pending: false }),
      Date.now() + 10000,
    );
    expect(sent).toHaveLength(3);
    await expect(
      consumeWake(
        { jobId: "job-1", phase: "continuation" },
        {
          send: async () => {
            throw new Error("unavailable");
          },
        },
        async () => ({ pending: true }),
      ),
    ).rejects.toThrow("unavailable");
  });
});
