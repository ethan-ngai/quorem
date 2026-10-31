import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { postgresDeadlines } from "./deadlines.ts";
import { prearmReceipts, consumePrearm } from "./prearm.ts";
import { retainBatch } from "./retention.ts";
import { seedCatalog } from "../../../../cli/seed.ts";
import { bindJobInputs, storeCustomInput } from "../../judging/inputs/bind.ts";
import { submissionSnapshots } from "../../judging/results/repository.ts";
import {
  drainDeadlines,
  activateDeadline,
} from "../../../../modules/events/scheduling/scheduling.ts";
const url = process.env.QUOREM_SCHEDULING_TEST_DATABASE_URL!;
const parsed = new URL(url);
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
  parsed.searchParams.has("host") ||
  parsed.pathname !== "/quorem_hono_scheduling_test"
)
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
  it("scrubs expired guest sidecars and normalized results without touching live or recent account work", async () => {
    await seedCatalog(pool, true);
    const version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
    const owner = `retention-${crypto.randomUUID()}`;
    const cases = [
      { name: "guest", kind: "guest", days: 8, state: "completed" },
      { name: "sidecar", kind: "guest", days: 8, state: "completed" },
      { name: "live", kind: "guest", days: 8, state: "running" },
      { name: "account", kind: "account", days: 8, state: "completed" },
      { name: "old-account", kind: "account", days: 31, state: "completed" },
    ] as const;
    const ids = new Map<string, string>();
    for (const item of cases) {
      const user = `${owner}-${item.name}`,
        workspace = crypto.randomUUID(),
        id = crypto.randomUUID();
      ids.set(item.name, id);
      await pool.query("INSERT INTO users(id,display_name,kind) VALUES($1,$1,$2)", [
        user,
        item.kind,
      ]);
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspace, user, version],
      );
      await pool.query(
        `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,lossless_cases,admitted_at) VALUES($1,$2,$3,'run',$4,'hash','running','[]'::jsonb,$5::jsonb,convert_to('[123]','UTF8'),clock_timestamp()-($6::text||' days')::interval)`,
        [
          id,
          user,
          workspace,
          item.name === "sidecar" ? "" : "secret",
          item.name === "sidecar" ? null : "{}",
          item.days,
        ],
      );
      if (item.name === "guest") {
        await pool.query(
          "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,convert_to('{}','UTF8'))",
          [id],
        );
        await pool.query(
          "INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) VALUES($1,'public',0,convert_to('{}','UTF8'))",
          [id],
        );
        await pool.query(
          `INSERT INTO submission_public_case_statuses(submission_id,channel,ordinal,case_index,status_json,status_hash) VALUES($1,'public',0,0,convert_to('"passed"','UTF8'),sha256(convert_to('"passed"','UTF8')))`,
          [id],
        );
        await pool.query("SELECT set_config('quorem.lossless_result_write','v1',false)");
        await pool.query(
          "UPDATE submissions SET result_payload=convert_to('{}','UTF8') WHERE id=$1",
          [id],
        );
      }
      if (item.state === "completed")
        await pool.query("UPDATE submissions SET state='completed' WHERE id=$1", [id]);
    }
    await retainBatch(run);
    const rows = await pool.query(
      `SELECT id,source,result IS NOT NULL AS result, result_payload IS NOT NULL AS payload, lossless_cases IS NOT NULL AS cases FROM submissions WHERE id=ANY($1::uuid[])`,
      [[...ids.values()]],
    );
    const byName = (name: string) => rows.rows.find((row) => row.id === ids.get(name));
    expect(byName("guest")).toMatchObject({
      source: "",
      result: false,
      payload: false,
      cases: false,
    });
    expect(byName("sidecar")).toMatchObject({ source: "", cases: false });
    expect(byName("old-account")).toMatchObject({ source: "", result: false, cases: false });
    for (const name of ["live", "account"])
      expect(byName(name)).toMatchObject({ source: "secret", result: true, cases: true });
    const remaining = await pool.query(
      `SELECT (SELECT count(*) FROM submission_result_headers WHERE submission_id=$1)::int AS headers,(SELECT count(*) FROM submission_public_result_cases WHERE submission_id=$1)::int AS cases,(SELECT count(*) FROM submission_public_case_statuses WHERE submission_id=$1)::int AS statuses`,
      [ids.get("guest")],
    );
    expect(remaining.rows[0]).toEqual({ headers: 0, cases: 0, statuses: 0 });
  });
  it("expires sealed job inputs and keeps shared fixtures, uncertain leases and authorized metadata", async () => {
    await seedCatalog(pool, true);
    const version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      prefix = `input-retention-${crypto.randomUUID()}`;
    const entries = [
      { name: "expired", state: "completed", finished: true, lease: false, kind: "guest", days: 8 },
      { name: "live", state: "running", finished: false, lease: false, kind: "guest", days: 8 },
      { name: "queued", state: "queued", finished: false, lease: false, kind: "guest", days: 8 },
      {
        name: "uncertain",
        state: "completed",
        finished: true,
        lease: true,
        kind: "guest",
        days: 8,
      },
      {
        name: "account-recent",
        state: "completed",
        finished: true,
        lease: false,
        kind: "account",
        days: 8,
      },
      {
        name: "account-old",
        state: "completed",
        finished: true,
        lease: false,
        kind: "account",
        days: 31,
      },
    ] as const;
    const rows = new Map<
      string,
      { user: string; submission: string; job: string; source: string; custom: Uint8Array }
    >();
    for (const item of entries) {
      const user = `${prefix}-${item.name}`,
        workspace = crypto.randomUUID(),
        submission = crypto.randomUUID(),
        job = crypto.randomUUID(),
        source = `${prefix}-source-${item.name}`;
      await pool.query("INSERT INTO users(id,display_name,kind) VALUES($1,$1,$2)", [
        user,
        item.kind,
      ]);
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspace, user, version],
      );
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,admitted_at) VALUES($1,$2,$3,'run',$4,'hash','running','[]','{}',clock_timestamp()-($5::text||' days')::interval)",
        [submission, user, workspace, source, item.days],
      );
      await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
        job,
        submission,
      ]);
      const custom = await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
          const hash = await storeCustomInput(tx, `${prefix}-custom-${item.name}`);
          const shared = await storeCustomInput(tx, `${prefix}-shared`);
          await bindJobInputs(tx, {
            jobId: job,
            owner: { version },
            level: 0,
            primary: "custom",
            custom: [hash, shared],
            caseCount: 2,
            sampleCount: 0,
            privateDetails: false,
            submitCasesAreSamples: false,
          });
          return hash;
        }),
      );
      if (item.name === "expired") {
        const attempt = crypto.randomUUID();
        await pool.query(
          "INSERT INTO execution_completion_receipts(job_id,attempt_id,sandbox_scope,outcome) VALUES($1,$2,'fixture','completed')",
          [job, attempt],
        );
        await pool.query(
          "INSERT INTO execution_verified_cases(job_id,ordinal,attempt_id,sandbox_scope,challenge_id,binding,frame_hash,type_mismatch,status) VALUES($1,0,$2,'fixture',$3,decode(repeat('00',32),'hex'),decode(repeat('11',32),'hex'),false,'accepted')",
          [job, attempt, crypto.randomUUID()],
        );
      }
      if (item.state !== "running")
        await pool.query("UPDATE submissions SET state=$2 WHERE id=$1", [submission, item.state]);
      if (item.finished)
        await pool.query(
          `UPDATE execution_jobs SET finished=true,lease_until=${item.lease ? "clock_timestamp()+interval '1 hour'" : "NULL"} WHERE id=$1`,
          [job],
        );
      rows.set(item.name, { user, submission, job, source, custom });
    }
    const expired = rows.get("expired")!,
      live = rows.get("live")!,
      uncertain = rows.get("uncertain")!,
      queued = rows.get("queued")!,
      accountRecent = rows.get("account-recent")!,
      accountOld = rows.get("account-old")!;
    const versionMetadata = (
      await pool.query("SELECT metadata_hash FROM runner_version_inputs WHERE version_id=$1", [
        version,
      ])
    ).rows[0].metadata_hash;
    const session = crypto.randomUUID(),
      fixture = (await pool.query("SELECT sha256(convert_to('{}'::jsonb::text,'UTF8')) AS id"))
        .rows[0].id;
    await pool.query(
      "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Fixture','{}','python','',$3,$4,$5,'token',$6,'token')",
      [
        session,
        expired.user,
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    );
    await pool.query(
      "INSERT INTO interview_question_snapshots(session_id,id,fixture) VALUES($1,$2,'{}')",
      [session, fixture],
    );
    await pool.query(
      "INSERT INTO runner_snapshot_inputs(session_id,fixture_id,metadata_hash,fixture_hash) VALUES($1,$2,$3,$4)",
      [session, fixture, versionMetadata, fixture],
    );
    await pool.query(
      "INSERT INTO runner_snapshot_input_cases(session_id,fixture_id,channel,stage,ordinal,blob_hash) VALUES($1,$2,'example',0,0,$3)",
      [session, fixture, expired.custom],
    );
    await pool.query(
      "UPDATE runner_snapshot_inputs SET sealed=true WHERE session_id=$1 AND fixture_id=$2",
      [session, fixture],
    );
    await retainBatch(run);
    const jobs = await pool.query("SELECT id FROM execution_jobs WHERE id=ANY($1::uuid[])", [
      [expired.job, live.job, uncertain.job, queued.job, accountRecent.job, accountOld.job],
    ]);
    expect(jobs.rows.map((r) => r.id).sort((a, b) => a.localeCompare(b))).toEqual(
      [live.job, uncertain.job, queued.job, accountRecent.job].sort((a, b) => a.localeCompare(b)),
    );
    const blobs = await pool.query(
      "SELECT encode(hash,'hex') AS hash FROM runner_input_blobs WHERE hash=ANY($1::bytea[])",
      [
        [
          Buffer.from(expired.custom),
          Buffer.from(live.custom),
          Buffer.from(uncertain.custom),
          Buffer.from(accountOld.custom),
          versionMetadata,
        ],
      ],
    );
    const hashes = blobs.rows.map((r) => r.hash);
    expect(hashes).not.toContain(Buffer.from(accountOld.custom).toString("hex"));
    for (const hash of [expired.custom, live.custom, uncertain.custom, versionMetadata])
      expect(hashes).toContain(Buffer.from(hash).toString("hex"));
    expect(
      (
        await pool.query(
          "SELECT 1 FROM runner_input_blobs WHERE hash=sha256(convert_to($1,'UTF8'))",
          [expired.source],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM runner_input_blobs WHERE hash=sha256(convert_to($1,'UTF8'))",
          [`${prefix}-shared`],
        )
      ).rowCount,
    ).toBe(1);
    const stream = await submissionSnapshots(run).read(
      {
        kind: "local",
        userId: expired.user,
        displayName: expired.user,
        admin: false,
        emailVerified: true,
        sessionId: "local",
        strongUntil: 0,
      },
      expired.submission,
    );
    const result = JSON.parse(await new Response(stream).text());
    expect(result).toMatchObject({ id: expired.submission, state: "completed" });
    expect(result.result).toBeUndefined();
  });
  it("does not collect a blob concurrently bound by a publishing transaction", async () => {
    await seedCatalog(pool, true);
    const version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      user = `gc-race-${crypto.randomUUID()}`,
      workspace = crypto.randomUUID(),
      submission = crypto.randomUUID(),
      job = crypto.randomUUID(),
      source = `race-source-${crypto.randomUUID()}`;
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [user]);
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
      [workspace, user, version],
    );
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run',$4,'hash','running','[]')",
      [submission, user, workspace, source],
    );
    await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
      job,
      submission,
    ]);
    await pool.query(
      "INSERT INTO runner_input_blobs(hash,data) VALUES(sha256(convert_to($1,'UTF8')),convert_to($1,'UTF8'))",
      [source],
    );
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publisher = run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        await bindJobInputs(tx, {
          jobId: job,
          owner: { version },
          level: 0,
          primary: "custom",
          custom: [],
          caseCount: 0,
          sampleCount: 0,
          privateDetails: false,
          submitCasesAreSamples: false,
        });
        ready();
        await proceed;
      }),
    );
    try {
      await locked;
      await retainBatch(run);
    } finally {
      release();
    }
    await publisher;
    await retainBatch(run);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM runner_job_inputs j JOIN runner_input_blobs b ON b.hash=j.source_hash WHERE j.job_id=$1 AND j.sealed",
          [job],
        )
      ).rowCount,
    ).toBe(1);
    const later = `gc-first-${crypto.randomUUID()}`;
    await pool.query(
      "INSERT INTO runner_input_blobs(hash,data) VALUES(sha256(convert_to($1,'UTF8')),convert_to($1,'UTF8'))",
      [later],
    );
    const collector = await pool.connect();
    try {
      await collector.query("BEGIN");
      await collector.query(
        "DELETE FROM runner_input_blobs WHERE hash=sha256(convert_to($1,'UTF8'))",
        [later],
      );
      const writer = run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) =>
          storeCustomInput(tx, later),
        ),
      );
      await collector.query("COMMIT");
      await writer;
    } finally {
      await collector.query("ROLLBACK").catch(() => {});
      collector.release();
    }
    expect(
      (
        await pool.query(
          "SELECT 1 FROM runner_input_blobs WHERE hash=sha256(convert_to($1,'UTF8')) AND data=convert_to($1,'UTF8')",
          [later],
        )
      ).rowCount,
    ).toBe(1);
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
