/** @file integration.ts @description Disposable PostgreSQL match lifecycle. @module matches */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import { drainDeadlines } from "../../../../modules/events/scheduling/scheduling.ts";
import { nodeCoordinator } from "../../../scheduling/shells.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresDeadlines } from "../../events/scheduling/deadlines.ts";
import { reconcileScheduledMatch } from "../reconcile/repository.ts";
import { matchLifecycle } from "./repository.ts";
const url = process.env.QUOREM_MATCH_LIFECYCLE_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).port !== "55467" ||
  new URL(url).pathname !== "/quorem_hono_lifecycle_test" ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
)
  throw new Error("Disposable match database required");
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
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,'lifecycle')", [problem]);
  await pool.query(
    'INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,\'T\',\'easy\',\'\',\'{"className":"Solution","methodName":"f","parameters":[{"name":"x","type":"int"}],"returnType":"int"}\',\'[]\',\'{}\',\'test\')',
    [version, problem],
  );
  await pool.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [problem, version]);
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
    [version],
  );
  await pool.query(
    "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,'[1]','2')",
    [version],
  );
  await pool.query(
    "INSERT INTO problem_test_cases(version_id,ordinal,args,expected) VALUES($1,0,'[3]','4')",
    [version],
  );
  await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [version]);
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
  assert.equal(
    (
      await pool.query(
        "SELECT ready FROM match_participants WHERE match_id=$1 AND owner_id='match-host'",
        [created.id],
      )
    ).rows[0].ready,
    true,
  );
  const changed = normalizeSettings({ ...locked, rules: { clipboard: "announce", focus: "off" } });
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
    JSON.stringify({ workspaceId: workspace, kind: "submit", source: "def f(x): return x" }),
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
  await pool.query(
    'UPDATE submissions SET state=\'completed\',result=\'{"verdict":"accepted","score":{"passed":1,"total":1}}\' WHERE id=$1',
    [submission],
  );
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
    rules: { clipboard: "announce", focus: "off" },
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
    const invalid = await fetch(`${base}/v1/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "http-bad" },
      body: JSON.stringify({ difficulty: "easy", extra: true }),
    });
    assert.equal(invalid.status, 400);
    const created = await fetch(`${base}/v1/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "http-create" },
      body: JSON.stringify({ difficulty: "easy" }),
    });
    assert.equal(created.status, 201);
    const data = (await created.json()) as { id: string };
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
void test("Go invitation ciphertext and settings fingerprint remain interoperable", async () => {
  const { fingerprint, settingsBody, inviteCipher } = await import("./crypto.ts");
  assert.equal(
    await fingerprint(settingsBody(settings)),
    "4e96a35f4479448464c566132f8078d5d08cc75a2f0787f8cd7af72eed12658a",
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
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'SQL','easy','','{}','[]','{}','test')",
    [v, p],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'postgresql','','postgresql-17-v1','quorem-harness-v2','')",
    [v],
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
    normalizeSettings({ ...settings, rules: { clipboard: "announce", focus: "warning" } }),
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
  assert.equal(retained.ruleEvents.length, 20);
  assert.ok(
    retained.ruleEvents.every((event) => event.kind === "clipboard" && event.action === "announce"),
  );
  await assert.rejects(repo.mutate(outsider, room.id, "outsider-rule", "rule-events", "focus"));
  await pool.query(
    "UPDATE match_participants SET forfeited=true WHERE match_id=$1 AND owner_id=$2",
    [room.id, actor.userId],
  );
  await assert.rejects(repo.mutate(actor, room.id, "forfeited-rule", "rule-events", "clipboard"));
});
