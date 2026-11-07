import { matchPreset } from "@quorem/contracts/match-rules";
/** @file integration.ts @description Disposable PostgreSQL match lifecycle. @module matches */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { persistQuestionVersion } from "../../problems/publication.ts";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { postgresExecutionCommands } from "../../judging/worker/repository.ts";
import { localVerifier } from "../../judging/worker/manifest-fixture.ts";
import { dockerSandbox } from "../../../../../../runner/src/sandbox/docker.ts";
import { executeAndStage } from "../../../../../../runner/src/engine/execute.ts";
import { finishAfterTeardown } from "../../../../../../runner/src/queue/finish.ts";
import { languageRuntime } from "@quorem/execution";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameText } from "../../../events/fanout/common.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import { drainDeadlines } from "../../../../modules/events/scheduling/scheduling.ts";
import { nodeCoordinator } from "../../../scheduling/shells.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresDeadlines } from "../../events/scheduling/deadlines.ts";
import { reconcileScheduledMatch } from "../reconcile/repository.ts";
import { matchLifecycle } from "./repository.ts";
const url = process.env.QUOREM_MATCH_LIFECYCLE_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable match database required");
assertRunnerFixture(url, ["/quorem_hono_lifecycle_test"]);
const pool = createNodePool({
  connectionString: url,
  max: 8,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: (e) => {
    throw e;
  },
});
const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, f);
const receipts = prearmReceipts(run),
  deadlines = postgresDeadlines(run);
let active = 0;
const schedulerErrors: unknown[] = [];
const coordinator = nodeCoordinator(
  async (shard) => {
    active++;
    try {
      const ids = await receipts.list(shard);
      let pending = false;
      for (const id of ids) {
        const status = await receipts.settle(id);
        if (status === "committed") await receipts.acknowledge(id);
        else if (status === "pending") pending = true;
      }
      const delay = await drainDeadlines(
        deadlines,
        (c) =>
          run((scope) =>
            scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
              reconcileScheduledMatch(tx, c.id, c.generation),
            ),
          ),
        shard,
        1,
      );
      return pending ? Math.min(delay ?? 1000, 1000) : delay;
    } finally {
      active--;
    }
  },
  (e) => {
    schedulerErrors.push(e);
  },
);
const repo = matchLifecycle(run, {
  inviteKey: new Uint8Array(32).fill(3),
  receipts,
  coordinator,
  shards: 1,
  guestCreation: true,
});
const principal = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: userId,
  strongUntil: 0,
});
const host = principal("match-host"),
  rival = principal("match-rival"),
  outsider = principal("match-outsider");
const version = crypto.randomUUID(),
  problem = crypto.randomUUID();
const settings = normalizeSettings({ difficulty: "easy", durationMinutes: 30 });
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES ('match-host','Host','account'),('match-rival','Rival','account'),('match-outsider','Outsider','account')",
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
      "utf8",
    ),
  );
  Object.assign(fixture.problem, {
    id: version,
    slug: "lifecycle",
    version: "1",
    title: "Lifecycle",
    tags: ["arrays"],
    statementMarkdown: "Return x plus one.",
    constraints: [],
    signature: {
      className: "Solution",
      methodName: "f",
      parameters: [{ name: "x", type: "int" }],
      returnType: "int",
    },
    examples: [{ args: [1], expected: 2, explanation: "Increment." }],
  });
  fixture.hiddenCases = [{ args: [3], expected: 4 }];
  fixture.approaches[0].implementations.find(
    (item: { language: string }) => item.language === "python",
  )!.source = "class Solution:\n def f(self,x): return x+1\n";
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,'lifecycle')`);
      await persistQuestionVersion(
        tx,
        JSON.stringify(fixture),
        problem,
        version,
        1,
        null,
        (language) => {
          const runtime = languageRuntime(language);
          return runtime ? { revision: runtime.revision, harness: runtime.harness } : undefined;
        },
      );
    }),
  );
});
after(async () => {
  coordinator.close();
  while (active) await new Promise((resolve) => setTimeout(resolve, 10));
  await pool.end();
  assert.deepEqual(schedulerErrors, []);
});
void test("creation serializes reservation and encrypts replay capability", async () => {
  const [a, b] = await Promise.allSettled([
    repo.create(host, "a", settings),
    repo.create(host, "b", settings),
  ]);
  assert.equal([a, b].filter((x) => x.status === "fulfilled").length, 1);
  const ok = (
    [a, b].find((x) => x.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
      inviteUrl: string;
    }>
  ).value;
  const key = a.status === "fulfilled" ? "a" : "b";
  assert.deepEqual(await repo.create(host, key, settings), ok);
  const stored = await pool.query(
    "SELECT response::text AS data FROM match_idempotency WHERE owner_id=$1 AND route='create'",
    [host.userId],
  );
  assert.doesNotMatch(stored.rows[0].data, new RegExp(ok.inviteUrl.split("/").at(-1)!));
  await assert.rejects(repo.read(outsider, ok.id));
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [ok.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    ok.id,
  ]);
  const ready = (await repo.mutate(host, ok.id, "host-ready", "ready", true)) as { state: string };
  assert.equal(ready.state, "ready");
  const started = (await repo.mutate(rival, ok.id, "rival-ready", "ready", true)) as {
    state: string;
    participants: { workspaceId?: string }[];
  };
  assert.equal(started.state, "active");
  assert.equal(started.participants.filter((x) => x.workspaceId).length, 1);
  const counts = await pool.query(
    "SELECT (SELECT count(*)::int FROM workspaces WHERE match_id=$1) AS workspaces,(SELECT count(*)::int FROM match_outbox WHERE match_id=$1) AS events",
    [ok.id],
  );
  assert.equal(counts.rows[0].workspaces, 2);
  assert.equal(counts.rows[0].events, 3);
  const result = (await repo.mutate(rival, ok.id, "forfeit", "forfeit", null)) as {
    state: string;
    outcome: { reason: string };
  };
  assert.equal(result.state, "completed");
  assert.equal(result.outcome.reason, "forfeit");
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM match_reservations WHERE match_id=$1", [
        ok.id,
      ])
    ).rows[0].n,
    0,
  );
});
void test("settings lock preserves readiness while rule changes reset it and leave releases the seat", async () => {
  const created = (await repo.create(host, "settings-room", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [created.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    created.id,
  ]);
  await repo.mutate(host, created.id, "ready-settings", "ready", true);
  const locked = normalizeSettings({ ...settings, admissionLocked: true });
  await repo.mutate(host, created.id, "lock", "settings", locked);
  const everyone = normalizeSettings({
    ...locked,
    rules: { ...locked.rules, settingsEditors: "everyone" },
  });
  const permissions = await repo.mutate(host, created.id, "permissions", "settings", everyone);
  const unchanged = await repo.mutate(host, created.id, "same-settings", "settings", everyone);
  assert.deepEqual(
    { ...(permissions as object), serverNow: undefined },
    { ...(unchanged as object), serverNow: undefined },
  );
  assert.equal(
    (
      await pool.query(
        "SELECT ready FROM match_participants WHERE match_id=$1 AND owner_id='match-host'",
        [created.id],
      )
    ).rows[0].ready,
    true,
  );
  const changed = normalizeSettings({
    ...locked,
    rules: { ...matchPreset("casual"), clipboard: "announce", focus: "off" },
  });
  await repo.mutate(host, created.id, "rules", "settings", changed);
  assert.equal(
    (
      await pool.query(
        "SELECT ready FROM match_participants WHERE match_id=$1 AND owner_id='match-host'",
        [created.id],
      )
    ).rows[0].ready,
    false,
  );
  const left = (await repo.mutate(rival, created.id, "leave", "leave", null)) as {
    participants: unknown[];
  };
  assert.equal(left.participants.length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM match_reservations WHERE owner_id='match-rival'",
        [],
      )
    ).rows[0].n,
    0,
  );
  await repo.mutate(host, created.id, "host-leave", "leave", null);
});
void test("deadline keeps unresolved work no-contest after late completion", async () => {
  const created = (await repo.create(host, "deadline-room", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [created.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    created.id,
  ]);
  await repo.mutate(host, created.id, "deadline-h", "ready", true);
  await repo.mutate(rival, created.id, "deadline-r", "ready", true);
  const workspace = (
    await pool.query(
      "SELECT workspace_id FROM match_participants WHERE match_id=$1 AND owner_id='match-rival'",
      [created.id],
    )
  ).rows[0].workspace_id;
  const { postgresWorkspaceAdmission } = await import("../../judging/admission/repository.ts");
  const { parseWorkspaceCommand } =
    await import("../../../../modules/judging/admission/command.ts");
  const receiptId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  await prearmReceipts(run, "execution").create(receiptId, 0);
  await coordinator.prearm(0);
  const command = await parseWorkspaceCommand(
    JSON.stringify({
      workspaceId: workspace,
      kind: "submit",
      source: "class Solution:\n def f(self,x): return x+1",
    }),
    "real-admit",
  );
  const admitted = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(rival, "real-admit", command, { receiptId, shard: 0, jobId });
  const submission = admitted.id;
  await pool.query(
    "UPDATE submissions SET admitted_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",
    [submission],
  );
  await pool.query(
    "UPDATE matches SET deadline=clock_timestamp()-interval '4 minutes',finalizing_at=clock_timestamp()-interval '3 minutes',state='finalizing' WHERE id=$1",
    [created.id],
  );
  const first = (await repo.read(host, created.id)) as {
    outcome: { kind: string; reason: string };
  };
  assert.equal(first.outcome.kind, "no_contest");
  const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
  if (!socket) throw new Error("Disposable Docker socket required");
  const verifier = await localVerifier(run);
  const root = await realpath(await mkdtemp(join(tmpdir(), "quorem-lifecycle-verified-")));
  try {
    const sandbox = await dockerSandbox({
      socket,
      stateRoot: root,
      namespace: "lifecycle-late",
      cleanupMs: 10000,
    });
    const port = postgresExecutionCommands(
      run,
      { inputProtocol: "manifest-v1", resumable: true, losslessCases: true, losslessResults: true },
      verifier.verification,
    );
    const job = await port.claimAfterTeardown(true, sandbox.scope, null);
    assert.equal(job?.jobId, jobId);
    await executeAndStage(job!, port, sandbox);
    await finishAfterTeardown(port, sandbox, job!);
    const completed = (
      await pool.query("SELECT state,result FROM submissions WHERE id=$1", [submission])
    ).rows[0];
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.verdict, "accepted");
  } finally {
    await verifier.close();
    await rm(root, { recursive: true, force: true });
  }
  const late = (await repo.read(host, created.id)) as { outcome: { kind: string; reason: string } };
  assert.deepEqual(late.outcome, first.outcome);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM match_reservations WHERE match_id=$1", [
        created.id,
      ])
    ).rows[0].n,
    0,
  );
  const events = await pool.query(
    "SELECT version::text,event_type FROM match_outbox WHERE match_id=$1 ORDER BY version",
    [created.id],
  );
  assert.equal(events.rows.at(-1).event_type, "match.completed");
  assert.equal(new Set(events.rows.map((x) => x.version)).size, events.rows.length);
});
void test("only published owner-visible selected questions are admitted", async () => {
  const privateProblem = crypto.randomUUID(),
    privateVersion = crypto.randomUUID();
  await pool.query("INSERT INTO problems(id,slug,owner_id) VALUES($1,$2,'match-rival')", [
    privateProblem,
    privateProblem,
  ]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Private','easy','','{}','[]','{}','test')",
    [privateVersion, privateProblem],
  );
  await pool.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [
    privateProblem,
    privateVersion,
  ]);
  await assert.rejects(
    repo.create(
      host,
      "private-denied",
      normalizeSettings({ selectedProblemVersionId: privateVersion }),
    ),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "invalid_input",
  );
  await assert.rejects(
    repo.create(
      rival,
      "unsealed-denied",
      normalizeSettings({ selectedProblemVersionId: privateVersion }),
    ),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "invalid_input",
  );
  const created = (await repo.create(
    host,
    "public-selected",
    normalizeSettings({ selectedProblemVersionId: version }),
  )) as { id: string };
  await repo.mutate(host, created.id, "close-selected", "leave", null);
});
void test("concurrent readiness and settings never creates duplicate workspaces", async () => {
  const created = (await repo.create(host, "race-room", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat,ready) VALUES($1,'match-rival',2,true)",
    [created.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    created.id,
  ]);
  const changed = normalizeSettings({
    ...settings,
    rules: { ...matchPreset("casual"), clipboard: "announce", focus: "off" },
  });
  await Promise.allSettled([
    repo.mutate(host, created.id, "race-ready", "ready", true),
    repo.mutate(host, created.id, "race-settings", "settings", changed),
  ]);
  const rows = await pool.query(
    "SELECT state,(SELECT count(*)::int FROM workspaces WHERE match_id=matches.id) AS workspaces FROM matches WHERE id=$1",
    [created.id],
  );
  assert.ok([0, 2].includes(rows.rows[0].workspaces));
  assert.equal(rows.rows[0].state === "active", rows.rows[0].workspaces === 2);
  if (rows.rows[0].state === "active")
    await repo.mutate(host, created.id, "race-forfeit", "forfeit", null);
  else await repo.mutate(host, created.id, "race-leave", "leave", null);
});
void test("Node HTTP maps lifecycle results and invalid commands", async () => {
  const { createApp } = await import("../../../../app.ts");
  const { matchLifecycleRoutes } = await import("../../../../modules/matches/lifecycle/routes.ts");
  const { serve } = await import("@hono/node-server");
  const app = createApp({ allowedOrigins: [], requestId: () => "match-node" }).route(
    "/",
    matchLifecycleRoutes({ lifecycle: repo, identify: async () => host }),
  );
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server unavailable");
    const base = `http://127.0.0.1:${address.port}`;
    const retired = await fetch(`${base}/v1/matches`, { method: "POST" });
    assert.equal(retired.status, 404);
    const data = (await repo.create(host, "http-create", settings)) as { id: string };
    const read = await fetch(`${base}/v1/matches/${data.id}`);
    assert.equal(read.status, 200);
    assert.equal(((await read.json()) as { state: string }).state, "waiting");
    const close = await fetch(`${base}/v1/matches/${data.id}/leave`, {
      method: "POST",
      headers: { "Idempotency-Key": "http-close" },
    });
    assert.equal(close.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
void test("revoked guest cannot replay cached match commands", async () => {
  const id = ((await repo.create(host, "guest-replay-room", settings)) as { id: string }).id,
    guestId = `guest-${crypto.randomUUID()}`,
    credential = `hash-${crypto.randomUUID()}`;
  await pool.query("INSERT INTO users(id,display_name,kind) VALUES($1,'Guest','guest')", [guestId]);
  await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,2)", [
    id,
    guestId,
  ]);
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", [
    guestId,
    id,
  ]);
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [credential, guestId, id],
  );
  const guest = {
    kind: "guest" as const,
    userId: guestId,
    displayName: "Guest",
    admin: false as const,
    emailVerified: false as const,
    sessionId: credential,
    strongUntil: 0 as const,
    credentialExpiresAt: 9999999999,
    scope: { kind: "match" as const, matchId: id },
  };
  await repo.mutate(guest, id, "guest-ready", "ready", false);
  await pool.query("UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1", [
    credential,
  ]);
  await assert.rejects(repo.mutate(guest, id, "guest-ready", "ready", false));
  await repo.mutate(host, id, "guest-room-close", "leave", null);
});
void test("invitation ciphertext replays and complete settings fingerprints remain stable", async () => {
  const { fingerprint, settingsBody, inviteCipher } = await import("./crypto.ts");
  assert.equal(
    await fingerprint(settingsBody(settings)),
    "6d0bc6476f64fb6303298e3fe80497c7610fbfdd2972490edec438951e0a8473",
  );
  const value = await inviteCipher(new Uint8Array(32).fill(3)).open({
    encrypted:
      "BAQEBAQEBAQEBAQEOwV6qY-kJXjwbPQrAzEbXLMV4RoqtyK3WgQlqwGhgDLVEEC5bieNNG0QrD5ewI3izHMhx7TMokyXu8ygKnqBBx-WF1tHGQJnv8rZ__0",
  });
  assert.deepEqual(value, { id: "fixture", inviteUrl: "/invite/test", state: "waiting" });
});
void test("real admission rechecks deadline after waiting for the aggregate lock", async () => {
  const { postgresWorkspaceAdmission } = await import("../../judging/admission/repository.ts");
  const { parseWorkspaceCommand } =
    await import("../../../../modules/judging/admission/command.ts");
  const created = (await repo.create(host, "admission-room", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [created.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    created.id,
  ]);
  await repo.mutate(host, created.id, "admit-h", "ready", true);
  await repo.mutate(rival, created.id, "admit-r", "ready", true);
  const workspace = (
    await pool.query(
      "SELECT workspace_id FROM match_participants WHERE match_id=$1 AND owner_id='match-rival'",
      [created.id],
    )
  ).rows[0].workspace_id;
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspace, kind: "submit", source: "def f(x): return x" }),
    "admit-key",
  );
  const executionReceipts = prearmReceipts(run, "execution"),
    receiptId = crypto.randomUUID();
  await executionReceipts.create(receiptId, 0);
  await coordinator.prearm(0);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE matches SET deadline=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
      [created.id],
    );
    const pending = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true })(
      rival,
      "admit-key",
      command,
      { receiptId, shard: 0, jobId: crypto.randomUUID() },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await client.query("COMMIT");
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "invalid_transition",
    );
  } finally {
    client.release();
  }
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM submissions WHERE match_id=$1", [created.id]))
      .rows[0].n,
    0,
  );
  await repo.read(host, created.id);
});
void test("deadline reconciliation and forfeit race settle exactly once", async () => {
  const room = (await repo.create(host, "deadline-forfeit-room", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [room.id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    room.id,
  ]);
  await repo.mutate(host, room.id, "race-h", "ready", true);
  await repo.mutate(rival, room.id, "race-r", "ready", true);
  await pool.query(
    "UPDATE matches SET deadline=clock_timestamp()-interval '4 minutes',finalizing_at=clock_timestamp()-interval '3 minutes' WHERE id=$1",
    [room.id],
  );
  const outcomes = await Promise.allSettled([
    repo.mutate(host, room.id, "forfeit-race", "forfeit", null),
    repo.read(rival, room.id),
  ]);
  assert.equal(outcomes.filter((v) => v.status === "rejected").length, 0);
  const state = (await pool.query("SELECT state,outcome FROM matches WHERE id=$1", [room.id]))
    .rows[0];
  assert.equal(state.state, "completed");
  assert.ok(["draw", "win"].includes(state.outcome.kind));
  if (state.outcome.kind === "win") {
    assert.equal(state.outcome.reason, "forfeit");
    assert.equal(
      state.outcome.winnerUserId,
      (await pool.query("SELECT participant_id::text AS id FROM users WHERE id='match-rival'"))
        .rows[0].id,
    );
  } else assert.equal(state.outcome.reason, "deadline_score");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM match_outbox WHERE match_id=$1 AND event_type='match.completed'",
        [room.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM match_reservations WHERE match_id=$1", [
        room.id,
      ])
    ).rows[0].n,
    0,
  );
});
void test("concurrent free-for-all starts create one workspace per participant", async () => {
  const ffa = normalizeSettings({ difficulty: "easy", mode: "free-for-all" }),
    id = ((await repo.create(host, "ffa-room", ffa)) as { id: string }).id;
  for (const [user, seat] of [
    [rival.userId, 2],
    [outsider.userId, 3],
  ] as const) {
    await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,$3)", [
      id,
      user,
      seat,
    ]);
    await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", [user, id]);
  }
  await Promise.all([
    repo.mutate(host, id, "ffa-h", "ready", true),
    repo.mutate(rival, id, "ffa-r", "ready", true),
    repo.mutate(outsider, id, "ffa-o", "ready", true),
  ]);
  const starts = await Promise.allSettled([
    repo.mutate(host, id, "ffa-start-a", "start", null),
    repo.mutate(host, id, "ffa-start-b", "start", null),
  ]);
  assert.equal(starts.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM workspaces WHERE match_id=$1", [id])).rows[0]
      .n,
    3,
  );
  await repo.mutate(host, id, "ffa-forfeit-h", "forfeit", null);
  const result = (await repo.mutate(rival, id, "ffa-forfeit-r", "forfeit", null)) as {
    state: string;
    outcome: { reason: string };
  };
  assert.equal(result.state, "completed");
  assert.equal(result.outcome.reason, "forfeit");
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM match_reservations WHERE match_id=$1", [id]))
      .rows[0].n,
    0,
  );
});
void test("guest hosting grant is checked again when a ready lobby starts", async () => {
  const guestSettings = normalizeSettings({ difficulty: "easy", accessMode: "guests_allowed" });
  await assert.rejects(
    repo.create(host, "guest-no-grant", guestSettings),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "entitlement_required",
  );
  const grant = crypto.randomUUID();
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'match-host','matches.host_guests','manual',$2,'fixture','test')",
    [grant, grant],
  );
  const id = ((await repo.create(host, "guest-granted", guestSettings)) as { id: string }).id;
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    id,
  ]);
  await repo.mutate(host, id, "guest-ready-h", "ready", true);
  await pool.query("UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE id=$1", [
    grant,
  ]);
  await assert.rejects(
    repo.mutate(rival, id, "guest-ready-r", "ready", true),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "entitlement_required",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT ready FROM match_participants WHERE match_id=$1 AND owner_id='match-rival'",
        [id],
      )
    ).rows[0].ready,
    false,
  );
  await repo.mutate(host, id, "guest-grant-close", "leave", null);
});
void test("selected SQL question gives each participant a PostgreSQL workspace", async () => {
  const p = crypto.randomUUID(),
    v = crypto.randomUUID();
  await pool.query("INSERT INTO problems(id,slug,owner_id) VALUES($1,$2,'match-host')", [p, p]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config) VALUES($1,$2,1,'SQL','easy','',NULL,'[]','{}','test','{}')",
    [v, p],
  );
  await pool.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [p, v]);
  await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [v]);
  const id = (
    (await repo.create(host, "sql-room", normalizeSettings({ selectedProblemVersionId: v }))) as {
      id: string;
    }
  ).id;
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [id],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('match-rival',$1)", [
    id,
  ]);
  await repo.mutate(host, id, "sql-h", "ready", true);
  await repo.mutate(rival, id, "sql-r", "ready", true);
  const rows = await pool.query(
    "SELECT language FROM workspaces WHERE match_id=$1 ORDER BY owner_id",
    [id],
  );
  assert.deepEqual(
    rows.rows.map((r) => r.language),
    ["postgresql", "postgresql"],
  );
  await repo.mutate(host, id, "sql-forfeit", "forfeit", null);
});
void test("rule announcements use canonical membership, replay, suppression and bounded history", async () => {
  const { createApp } = await import("../../../../app.ts");
  const { matchLifecycleRoutes } = await import("../../../../modules/matches/lifecycle/routes.ts");
  const actor = principal(`rule-${crypto.randomUUID()}`),
    peer = principal(`rule-${crypto.randomUUID()}`);
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES($1,'Host','account'),($2,'Peer','account')",
    [actor.userId, peer.userId],
  );
  const room = (await repo.create(
    actor,
    "rule-create",
    normalizeSettings({
      ...settings,
      rules: { ...matchPreset("casual"), clipboard: "announce", focus: "warning" },
    }),
  )) as { id: string };
  await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,2)", [
    room.id,
    peer.userId,
  ]);
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", [
    peer.userId,
    room.id,
  ]);
  await repo.mutate(actor, room.id, "rule-ready-a", "ready", true);
  await repo.mutate(peer, room.id, "rule-ready-b", "ready", true);
  const app = createApp({ allowedOrigins: [], requestId: () => "rule" }).route(
    "/",
    matchLifecycleRoutes({ lifecycle: repo, identify: async () => actor }),
  );
  const report = (key: string, kind: string) =>
    app.request(`/v1/matches/${room.id}/rule-events`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ kind }),
    });
  assert.equal((await report("bad", "paste")).status, 400);
  const first = await report("one", "clipboard");
  assert.equal(first.status, 200);
  const snapshot = (await first.json()) as { version: string; ruleEvents: unknown[] };
  assert.equal(snapshot.ruleEvents.length, 1);
  assert.deepEqual(await (await report("one", "clipboard")).json(), snapshot);
  assert.equal((await report("one", "focus")).status, 409);
  const suppressed = (await (await report("two", "clipboard")).json()) as typeof snapshot;
  assert.equal(suppressed.version, snapshot.version);
  await pool.query("UPDATE match_participants SET last_rule_event_at=NULL WHERE match_id=$1", [
    room.id,
  ]);
  const warning = (await (await report("warning", "focus")).json()) as typeof snapshot;
  assert.equal(warning.version, snapshot.version);
  for (let i = 0; i < 22; i++) {
    await pool.query("UPDATE match_participants SET last_rule_event_at=NULL WHERE match_id=$1", [
      room.id,
    ]);
    await repo.mutate(actor, room.id, `report-${i}`, "rule-events", "clipboard");
  }
  const retained = (await repo.read(peer, room.id)) as {
    ruleEvents: { kind: string; action: string }[];
  };
  assert.equal(retained.ruleEvents.length, 23);
  assert.ok(
    retained.ruleEvents.every((event) => event.kind === "clipboard" && event.action === "announce"),
  );
  await assert.rejects(repo.mutate(outsider, room.id, "outsider-rule", "rule-events", "focus"));
  const other = (await repo.create(outsider, "rule-guest-room", settings)) as { id: string };
  const guestId = `rule-guest-${crypto.randomUUID()}`,
    guestToken = `rule-token-${crypto.randomUUID()}`;
  await pool.query("INSERT INTO users(id,display_name,kind) VALUES($1,'Guest','guest')", [guestId]);
  await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,2)", [
    other.id,
    guestId,
  ]);
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [guestToken, guestId, other.id],
  );
  const guest = {
    kind: "guest" as const,
    userId: guestId,
    displayName: "Guest",
    admin: false as const,
    emailVerified: false as const,
    sessionId: guestToken,
    strongUntil: 0 as const,
    credentialExpiresAt: 9999999999,
    scope: { kind: "match" as const, matchId: other.id },
  };
  await assert.rejects(
    repo.mutate(guest, room.id, "foreign-guest-rule", "rule-events", "clipboard"),
  );
  await repo.mutate(outsider, other.id, "rule-guest-close", "leave", null);
  await pool.query(
    "UPDATE match_participants SET forfeited=true WHERE match_id=$1 AND owner_id=$2",
    [room.id, actor.userId],
  );
  await assert.rejects(repo.mutate(actor, room.id, "forfeited-rule", "rule-events", "clipboard"));
});

void test(
  "live match presence is derived from scoped socket leases across HTTP and Node WebSockets",
  { timeout: 30000 },
  async () => {
    const { createServer } = await import("node:http");
    const { default: WebSocket } = await import("ws");
    const { installNodeSockets } = await import("../../../../runtime/node/socket/server.ts");
    const { matchSocketSnapshot } = await import("../../../../modules/events/socket/match.ts");
    const { matchSocketLeases } = await import("../socket/leases.ts");
    const { matchLifecycleRoutes } =
      await import("../../../../modules/matches/lifecycle/routes.ts");
    const { createApp } = await import("../../../../app.ts");
    const hostId = `presence-host-${crypto.randomUUID()}`,
      rivalId = `presence-rival-${crypto.randomUUID()}`;
    const h = principal(hostId),
      r = principal(rivalId),
      leases = matchSocketLeases(run);
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host'),($2,'Rival')", [
      hostId,
      rivalId,
    ]);
    const room = (await repo.create(h, "presence-create", settings)) as { id: string };
    await pool.query(
      "INSERT INTO match_participants(match_id,owner_id,seat,presence) VALUES($1,$2,2,'online')",
      [room.id, rivalId],
    );
    const publicId = (
      await pool.query("SELECT participant_id::text AS id FROM users WHERE id=$1", [rivalId])
    ).rows[0].id as string;
    await pool.query(
      "INSERT INTO realtime_presence_leases(id,topic,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 minute'),($4,$5,$6,clock_timestamp()+interval '1 minute'),($7,$2,$6,clock_timestamp()-interval '1 second')",
      [
        crypto.randomUUID(),
        `/matches/${room.id}`,
        publicId,
        crypto.randomUUID(),
        `/matches/${crypto.randomUUID()}`,
        rivalId,
        crypto.randomUUID(),
      ],
    );
    const app = createApp({ allowedOrigins: [], requestId: () => "presence" }).route(
      "/",
      matchLifecycleRoutes({ lifecycle: repo, identify: async () => h }),
    );
    type Snapshot = {
      version: string;
      serverNow: string;
      participants: { userId: string; presence: string }[];
    };
    const read = async () =>
      (await (await app.request(`/v1/matches/${room.id}`)).json()) as Snapshot;
    const presence = (snapshot: Snapshot, id: string) =>
      snapshot.participants.find((p) => p.userId === id)!.presence;
    const hostPublic = (
      await pool.query("SELECT participant_id::text AS id FROM users WHERE id=$1", [hostId])
    ).rows[0].id as string;
    assert.notEqual(publicId, rivalId);
    assert.equal(presence(await read(), publicId), "offline");
    const server = createServer((_req, res) => res.writeHead(404).end());
    const stop = installNodeSockets(server, {
      origins: ["https://example.test"],
      heartbeatMs: 1000,
      resolve: async (request) => {
        const actor = new URL(request.url).pathname === "/host" ? h : r;
        const lease = await leases.acquire(actor, room.id);
        return {
          mode: "match",
          security: {
            verify: async () => ({ principal: actor, binding: actor.userId }),
            authorize: async () => "member",
          },
          subscription: { subscribe: async () => () => {} },
          snapshot: matchSocketSnapshot(room.id, repo),
          renew: (who) => leases.renew(who, room.id, lease),
          release: () => leases.release(actor.userId, room.id, lease),
        };
      },
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
    const sockets: InstanceType<typeof WebSocket>[] = [];
    const connect = async (path: string) => {
      const ws = new WebSocket(base + path, ["quorem"], {
        headers: { origin: "https://example.test" },
      });
      sockets.push(ws);
      const frames: Snapshot[] = [];
      ws.on("message", (raw) => {
        const envelope = JSON.parse(frameText(raw));
        ws.send(JSON.stringify({ type: "receipt", id: envelope.receipt }));
        if (envelope.payload?.type === "match.updated") frames.push(envelope.payload.payload);
      });
      await new Promise<void>((resolve) => ws.once("open", resolve));
      for (let i = 0; i < 200 && !frames.length; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(frames.length);
      return { ws, frames };
    };
    const waitFor = async (predicate: () => Promise<boolean>) => {
      for (let i = 0; i < 300; i++) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("presence timeout");
    };
    try {
      const one = await connect("/host"),
        two = await connect("/host"),
        other = await connect("/rival");
      const initial = await read();
      assert.equal(presence(initial, hostPublic), "online");
      assert.equal(presence(initial, publicId), "online");
      assert.equal(presence(other.frames[0], publicId), "online");
      const readySnapshot = (await repo.mutate(
        h,
        room.id,
        "presence-ready",
        "ready",
        true,
      )) as Snapshot;
      assert.equal(presence(readySnapshot, hostPublic), "online");
      one.ws.close();
      await waitFor(
        async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM realtime_presence_leases WHERE topic=$1 AND subject=$2 AND expires_at>clock_timestamp()",
                [`/matches/${room.id}`, hostId],
              )
            ).rows[0].count,
          ) === 1,
      );
      assert.equal(presence(await read(), hostPublic), "online");
      two.ws.close();
      await waitFor(async () => presence(await read(), hostPublic) === "offline");
      await waitFor(async () =>
        other.frames.some(
          (frame) =>
            frame.version === readySnapshot.version &&
            Date.parse(frame.serverNow) > Date.parse(readySnapshot.serverNow) &&
            presence(frame, hostPublic) === "offline" &&
            presence(frame, publicId) === "online",
        ),
      );
      const expired = await leases.acquire(r, room.id);
      await pool.query(
        "UPDATE realtime_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [expired],
      );
      other.ws.close();
      await waitFor(async () => presence(await read(), publicId) === "offline");
    } finally {
      for (const ws of sockets) ws.terminate();
      await stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.query(
        "DELETE FROM realtime_presence_leases WHERE topic=$1 OR subject IN ($2,$3,$4)",
        [`/matches/${room.id}`, hostId, rivalId, publicId],
      );
      await repo.mutate(h, room.id, "presence-close", "leave", null);
    }
  },
);

void test("match snapshots carry saved profile colors and pictures", async () => {
  await pool.query(
    "UPDATE users SET profile_color=7,profile_image='/profile/rival.png' WHERE id='match-rival'",
  );
  const created = (await repo.create(host, "profile-colors", settings)) as { id: string };
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'match-rival',2)",
    [created.id],
  );
  const snapshot = (await repo.read(host, created.id)) as {
    participants: { displayName: string; color?: number; image?: string }[];
  };
  const profile = snapshot.participants.find((person) => person.displayName === "Rival")!;
  assert.equal(profile.color, 7);
  assert.equal(profile.image, "/profile/rival.png");
  assert.equal(
    snapshot.participants.find((person) => person.displayName === "Host")!.color,
    undefined,
  );
});

async function rulesRoom(rules = matchPreset()) {
  const actor = principal(`rules-${crypto.randomUUID()}`),
    peer = principal(`rules-${crypto.randomUUID()}`);
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES($1,'Actor','account'),($2,'Peer','account')",
    [actor.userId, peer.userId],
  );
  const created = (await repo.create(
    actor,
    crypto.randomUUID(),
    normalizeSettings({ ...settings, selectedProblemVersionId: version, rules }),
  )) as { id: string };
  await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,2)", [
    created.id,
    peer.userId,
  ]);
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", [
    peer.userId,
    created.id,
  ]);
  return { ...created, actor, peer };
}
async function activateRulesRoom(room: Awaited<ReturnType<typeof rulesRoom>>) {
  await repo.mutate(room.actor, room.id, crypto.randomUUID(), "ready", true);
  return (await repo.mutate(
    room.peer,
    room.id,
    crypto.randomUUID(),
    "ready",
    true,
  )) as import("@quorem/contracts").MatchSnapshot;
}
void test("paid assistance confirms exact cost, grants once, shares penalties, and rejects forbidden reveals", async () => {
  const room = await rulesRoom();
  await pool.query("UPDATE match_participants SET competitor_id='team:1' WHERE match_id=$1", [
    room.id,
  ]);
  await activateRulesRoom(room);
  const quote = await repo.ruleAction(room.actor, room.id, "quote", { kind: "topics" });
  assert.equal(quote.revealed, undefined);
  assert.equal(quote.quote.seconds, 30);
  const { ruleApproval } = await import("@quorem/contracts/match-rules");
  await assert.rejects(
    repo.ruleAction(room.actor, room.id, "bad-cost", {
      kind: "topics",
      approval: { ...ruleApproval(quote.quote), seconds: 0 },
    }),
  );
  const revealed = await repo.ruleAction(room.actor, room.id, "reveal", {
    kind: "topics",
    approval: ruleApproval(quote.quote),
  });
  assert.deepEqual(revealed.revealed?.topics, ["arrays"]);
  assert.deepEqual(
    await repo.ruleAction(room.actor, room.id, "reveal", {
      kind: "topics",
      approval: ruleApproval(quote.quote),
    }),
    revealed,
  );
  const peerQuote = await repo.ruleAction(room.peer, room.id, "peer-quote", { kind: "topics" });
  assert.equal(peerQuote.quote.seconds, 0);
  assert.equal(peerQuote.quote.alreadyRevealed, true);
  const snapshot = (await repo.read(
    room.peer,
    room.id,
  )) as import("@quorem/contracts").MatchSnapshot;
  assert.ok(snapshot.participants.every((p) => p.penaltySeconds === 30));
  assert.equal(snapshot.ruleEvents.length, 1);
  assert.equal(snapshot.ruleEvents[0].action, "penalty");
  await assert.rejects(repo.ruleAction(outsider, room.id, "outsider", { kind: "topics" }));
  const strict = await rulesRoom(matchPreset("tournament"));
  await activateRulesRoom(strict);
  await assert.rejects(repo.ruleAction(strict.actor, strict.id, "blocked", { kind: "topics" }));
});
void test("assistance can unlock silently or notify once without charging", async () => {
  for (const access of ["free", "announce"] as const) {
    const rules = matchPreset();
    rules.assistance.topics.access = access;
    const room = await rulesRoom(rules);
    await activateRulesRoom(room);
    const { quote } = await repo.ruleAction(room.actor, room.id, "quote", { kind: "topics" });
    assert.equal(quote.seconds, 0);
    assert.equal(quote.points, 0);
    const opened = await repo.ruleAction(room.actor, room.id, "open", {
      kind: "topics",
      approval: quote,
    });
    assert.deepEqual(opened.revealed?.topics, ["arrays"]);
    const again = await repo.ruleAction(room.actor, room.id, "again", { kind: "topics" });
    assert.equal(again.quote.alreadyRevealed, true);
    await repo.ruleAction(room.actor, room.id, "reopen", { kind: "topics", approval: again.quote });
    const snapshot = (await repo.read(
      room.peer,
      room.id,
    )) as import("@quorem/contracts").MatchSnapshot;
    assert.deepEqual(
      snapshot.ruleEvents.map((event) => [event.kind, event.action]),
      access === "announce" ? [["topics", "announce"]] : [],
    );
  }
});
void test("members edit lobby rules only with host permission; permission edits stay host-only", async () => {
  const rules = matchPreset();
  rules.settingsEditors = "everyone";
  const room = await rulesRoom(rules);
  await repo.mutate(room.actor, room.id, "one-ready", "ready", true);
  await repo.mutate(
    room.peer,
    room.id,
    "change",
    "settings",
    normalizeSettings({
      ...settings,
      selectedProblemVersionId: version,
      rules: { ...rules, victory: "high_score" },
    }),
  );
  const snapshot = (await repo.read(
    room.actor,
    room.id,
  )) as import("@quorem/contracts").MatchSnapshot;
  assert.ok(snapshot.participants.every((p) => !p.ready));
  await assert.rejects(
    repo.mutate(
      room.peer,
      room.id,
      "escalate",
      "settings",
      normalizeSettings({ ...settings, rules: { ...rules, settingsEditors: "host" } }),
    ),
  );
  await activateRulesRoom(room);
  await assert.rejects(
    repo.mutate(
      room.peer,
      room.id,
      "active-change",
      "settings",
      normalizeSettings({ ...settings, rules }),
    ),
  );
});
void test("paid submission admission binds approval, cooldown and failed-job refunds atomically", async () => {
  const { postgresWorkspaceAdmission } = await import("../../judging/admission/repository.ts");
  const { parseWorkspaceCommand } =
    await import("../../../../modules/judging/admission/command.ts");
  const { ruleApproval } = await import("@quorem/contracts/match-rules");
  const rules = matchPreset("strict");
  rules.submissions.freeSubmissions = 0;
  const room = await rulesRoom(rules);
  await activateRulesRoom(room);
  const workspace = (
    await pool.query(
      "SELECT workspace_id FROM match_participants WHERE match_id=$1 AND owner_id=$2",
      [room.id, room.actor.userId],
    )
  ).rows[0].workspace_id;
  const quoted = await repo.ruleAction(room.actor, room.id, "submit-quote", { kind: "submission" });
  const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true });
  const body = {
    workspaceId: workspace,
    kind: "submit",
    source: "class Solution:\n def f(self,x): return x",
  };
  await assert.rejects(
    admit(
      room.actor,
      "missing-approval",
      await parseWorkspaceCommand(JSON.stringify(body), "missing-approval"),
      { receiptId: null, shard: 0, jobId: crypto.randomUUID() },
    ),
  );
  const command = await parseWorkspaceCommand(
    JSON.stringify({ ...body, matchApproval: ruleApproval(quoted.quote) }),
    "paid",
  );
  const admitted = await admit(room.actor, "paid", command, {
    receiptId: null,
    shard: 0,
    jobId: crypto.randomUUID(),
  });
  assert.equal(
    (
      await admit(room.actor, "paid", command, {
        receiptId: null,
        shard: 0,
        jobId: crypto.randomUUID(),
      })
    ).id,
    admitted.id,
  );
  await assert.rejects(
    admit(room.actor, "cooldown", command, {
      receiptId: null,
      shard: 0,
      jobId: crypto.randomUUID(),
    }),
    /Submit available/,
  );
  const snapshot = (await repo.read(
    room.actor,
    room.id,
  )) as import("@quorem/contracts").MatchSnapshot;
  assert.equal(snapshot.participants.find((p) => p.penaltySeconds === 10)?.penaltySeconds, 10);
  assert.deepEqual(
    snapshot.ruleEvents.map(({ kind, action, seconds }) => [kind, action, seconds]),
    [["submission", "penalty", 10]],
  );
  await pool.query("UPDATE execution_jobs SET finished=true WHERE submission_id=$1", [admitted.id]);
  await pool.query("UPDATE submissions SET state='failed' WHERE id=$1", [admitted.id]);
  const retry = await repo.ruleAction(room.actor, room.id, "retry-quote", { kind: "submission" });
  assert.equal(retry.quote.cooldownSeconds, 0);
  const refunded = (await repo.read(
    room.actor,
    room.id,
  )) as import("@quorem/contracts").MatchSnapshot;
  assert.ok(refunded.participants.every((p) => p.penaltySeconds === 0));
  assert.equal(refunded.ruleEvents.length, 0);
});
for (const accepted of [false, true])
  void test(`${accepted ? "passed" : "failed"} hidden reveal exposes only its sealed input and result after approval`, async () => {
    const { postgresWorkspaceAdmission } = await import("../../judging/admission/repository.ts");
    const { parseWorkspaceCommand } =
      await import("../../../../modules/judging/admission/command.ts");
    const { submissionSnapshots } = await import("../../judging/results/repository.ts");
    const { ruleApproval } = await import("@quorem/contracts/match-rules");
    const room = await rulesRoom({ ...matchPreset(), victory: "high_score" });
    await activateRulesRoom(room);
    const workspace = (
      await pool.query(
        "SELECT workspace_id FROM match_participants WHERE match_id=$1 AND owner_id=$2",
        [room.id, room.actor.userId],
      )
    ).rows[0].workspace_id;
    const jobId = crypto.randomUUID();
    const command = await parseWorkspaceCommand(
      JSON.stringify({
        workspaceId: workspace,
        kind: "submit",
        source: `class Solution:\n def f(self,x): return x${accepted ? "+1" : ""}`,
      }),
      "hidden-run",
    );
    const admitted = await postgresWorkspaceAdmission(run, {
      losslessCases: true,
      guestExecution: true,
    })(room.actor, "hidden-run", command, { receiptId: null, shard: 0, jobId });
    const verifier = await localVerifier(run);
    const root = await realpath(await mkdtemp(join(tmpdir(), "quorem-hidden-reveal-")));
    try {
      const sandbox = await dockerSandbox({
        socket: process.env.QUOREM_TEST_DOCKER_SOCKET!,
        stateRoot: root,
        namespace: "hidden-reveal",
        cleanupMs: 10000,
      });
      const port = postgresExecutionCommands(
        run,
        {
          inputProtocol: "manifest-v1",
          resumable: true,
          losslessCases: true,
          losslessResults: true,
        },
        verifier.verification,
      );
      const job = await port.claimAfterTeardown(true, sandbox.scope, null);
      assert.equal(job?.jobId, jobId);
      await executeAndStage(job!, port, sandbox);
      await finishAfterTeardown(port, sandbox, job!);
    } finally {
      await verifier.close();
      await rm(root, { recursive: true, force: true });
    }
    const publicResult = JSON.parse(
      await new Response(await submissionSnapshots(run).read(room.actor, admitted.id)).text(),
    );
    assert.equal(publicResult.hiddenCases, undefined);
    assert.equal(publicResult.verdict, accepted ? "accepted" : "wrong_answer");
    const request = { kind: "hiddenCase" as const, submissionId: admitted.id, caseIndex: 0 };
    const quoted = await repo.ruleAction(room.actor, room.id, "hidden-quote", request);
    assert.equal(quoted.revealed, undefined);
    assert.equal(quoted.quote.points, 10);
    await assert.rejects(repo.ruleAction(room.peer, room.id, "foreign-case", request));
    await assert.rejects(
      repo.ruleAction(room.actor, room.id, "missing-case", { ...request, caseIndex: 1 }),
    );
    const revealed = await repo.ruleAction(room.actor, room.id, "hidden-open", {
      ...request,
      approval: ruleApproval(quoted.quote),
    });
    assert.equal(JSON.parse(revealed.revealed!.result!).actual, accepted ? 4 : 3);
    assert.equal(JSON.parse(revealed.revealed!.result!).expected, 4);
    assert.ok(revealed.revealed!.input!.includes("3"));
    const again = await repo.ruleAction(room.actor, room.id, "hidden-again", request);
    assert.equal(again.quote.points, 0);
  });
