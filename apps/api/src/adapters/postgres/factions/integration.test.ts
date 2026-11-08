import type { TeamLobby } from "@quorem/contracts/factions";
import { postgresDispatch } from "../events/dispatch.ts";
import { postgresWorkspaceAdmission } from "../judging/admission/repository.ts";
import { parseWorkspaceCommand } from "../../../modules/judging/admission/command.ts";
import { partyRepository } from "../parties/repository.ts";
import { prearmReceipts } from "../events/scheduling/prearm.ts";
import { normalizePartySettings } from "../../../modules/parties/model.ts";
/** @file integration.test.ts @description Disposable team isolation and atomic ballot execution checks. @module factions */
import { beforeAll, afterAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { languageRuntime } from "@quorem/execution";
import { matchPreset } from "@quorem/contracts/match-rules";
import { persistQuestionVersion } from "../problems/publication.ts";
import { teamActionExecutor } from "./actions.ts";
import { paidTeamActions } from "./paid-actions.ts";
import { prepareRuleAction, executeRuleAction } from "../matches/rules/actions.ts";
import { submissionSnapshots } from "../judging/results/repository.ts";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
import { factionRepository } from "./repository.ts";
import { ChangeSet } from "@codemirror/state";
const url = process.env.QUOREM_FACTIONS_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable Factions database required");
assertRunnerFixture(url, ["/quorem_factions_test"]);
const pool = createNodePool({
  connectionString: url,
  max: 5,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: () => {},
});
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 10_000 }, fn);
const ids = Object.fromEntries(["a", "b", "c", "d"].map((x) => [x, crypto.randomUUID()]));
const match = crypto.randomUUID(),
  problem = crypto.randomUUID(),
  version = crypto.randomUUID(),
  workspace1 = crypto.randomUUID(),
  workspace2 = crypto.randomUUID();
const user = (id: string) => ({
  kind: "local" as const,
  userId: id,
  displayName: id,
  admin: false,
  emailVerified: true,
  sessionId: id,
  strongUntil: 0,
});
let executed = 0;
const repo = factionRepository(run, {
  async quote() {
    return { action: { kind: "concede" }, ruleVersion: "v1", cost: { seconds: 0, points: 0 } };
  },
  async execute() {
    executed++;
  },
});
beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("migrations"));
  for (const [id, participant] of Object.entries(ids))
    await pool.query(
      "INSERT INTO users(id,participant_id,display_name,kind) VALUES($1,$2,$1,'account')",
      [id, participant],
    );
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,'faction-fixture')", [problem]);
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../fixtures/problems/run-widths.json", import.meta.url),
      "utf8",
    ),
  );
  Object.assign(fixture.problem, {
    id: version,
    slug: "faction-fixture",
    version: "1",
    tags: ["array"],
  });
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, (tx) =>
      persistQuestionVersion(tx, JSON.stringify(fixture), problem, version, 1, null, (language) => {
        const r = languageRuntime(language);
        return r ? { revision: r.revision, harness: r.harness } : undefined;
      }),
    ),
  );
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,mode,difficulties,problem_version_id,started_at,deadline,rules) VALUES($1,'a','fixture',clock_timestamp()+interval '1 hour',30,'active','factions',ARRAY['easy'],$2,clock_timestamp(),clock_timestamp()+interval '30 minutes','{}')",
    [match, version],
  );
  const rules = matchPreset("strict");
  rules.submissions = { cooldownSeconds: 0, freeSubmissions: 0, seconds: 10, points: 1 };
  await pool.query("UPDATE matches SET rules=$2 WHERE id=$1", [match, JSON.stringify(rules)]);
  for (const [wid, owner] of [
    [workspace1, "a"],
    [workspace2, "c"],
  ])
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id,team) VALUES($1,$2,$3,'python','match',$4,CASE WHEN $2='a' THEN 1 ELSE 2 END)",
      [wid, owner, version, match],
    );
  for (const [i, id] of ["a", "b", "c", "d"].entries())
    await pool.query(
      "INSERT INTO match_participants(match_id,owner_id,seat,team,workspace_id,competitor_id) VALUES($1,$2,$3,$4,$5,'team:'||($4::smallint)::text)",
      [match, id, i + 1, i < 2 ? 1 : 2, i < 2 ? workspace1 : workspace2],
    );
  await pool.query(
    "INSERT INTO match_teams(match_id,team,workspace_id,source) VALUES($1,1,$2,'abc'),($1,2,$3,'secret')",
    [match, workspace1, workspace2],
  );
});
afterAll(() => pool.end());
test("team snapshots isolate document, peers and votes", async () => {
  const a = (await repo.read(user("a"), match)) as any;
  const b = (await repo.read(user("b"), match)) as any;
  const c = (await repo.read(user("c"), match)) as any;
  expect(a.document.source).toBe("abc");
  expect(b.workspaceId).toBe(workspace1);
  expect(c.document.source).toBe("secret");
  expect(a.members.map((m: any) => m.userId)).toEqual([ids.a, ids.b]);
  await expect(repo.read(user("outsider"), match)).rejects.toThrow();
  await repo.command(user("a"), match, "cursor", "presence", {
    clientID: "a-tab",
    epoch: a.document.epoch,
    version: 0,
    anchor: 0,
    head: 1,
  });
  expect(((await repo.read(user("b"), match)) as any).peers).toHaveLength(1);
  expect(((await repo.read(user("c"), match)) as any).peers).toHaveLength(0);
});
test("document retries are idempotent; foreign epoch and stale changes rejected", async () => {
  const a = (await repo.read(user("a"), match)) as any;
  const body = {
    epoch: a.document.epoch,
    version: 0,
    updates: [{ clientID: "a-tab", changes: ChangeSet.of({ from: 3, insert: "!" }, 3).toJSON() }],
  };
  await repo.command(user("a"), match, "edit", "push", body);
  await repo.command(user("a"), match, "edit", "push", body);
  expect(((await repo.read(user("b"), match)) as any).document).toMatchObject({
    source: "abc!",
    version: 1,
  });
  await expect(repo.command(user("b"), match, "stale", "push", body)).rejects.toThrow();
  await expect(
    repo.command(user("c"), match, "foreign", "pull", { epoch: a.document.epoch, version: 0 }),
  ).rejects.toThrow();
});
test("fixed team majority executes once; foreign vote inaccessible", async () => {
  const vote = (await repo.command(user("a"), match, "proposal", "propose", {
    action: { kind: "concede" },
  })) as any;
  expect(vote.state).toBe("pending");
  expect(executed).toBe(0);
  await expect(
    repo.command(user("c"), match, "spy", "vote", { id: vote.id, approve: true }),
  ).rejects.toThrow();
  expect(((await repo.read(user("c"), match)) as any).votes).toHaveLength(0);
  await repo.command(user("b"), match, "approve", "vote", { id: vote.id, approve: true });
  await repo.command(user("b"), match, "approve", "vote", { id: vote.id, approve: true });
  await repo.command(user("b"), match, "again", "vote", { id: vote.id, approve: true });
  expect(executed).toBe(1);
});

const live = factionRepository(
  run,
  teamActionExecutor(paidTeamActions({ losslessCases: true, guestExecution: true })),
  async () => {
    throw new Error("Simulated crash before wake");
  },
);
test("paid submit freezes source, requires majority, shares result and charges once", async () => {
  const vote = (await live.command(user("a"), match, "paid-proposal", "propose", {
    action: { kind: "submit" },
  })) as any;
  expect(vote.quote.cost.seconds).toBe(10);
  const direct = await parseWorkspaceCommand(
    JSON.stringify({
      workspaceId: workspace1,
      kind: "submit",
      source: "bypass",
      level: 0,
      matchApproval: { ruleVersion: vote.quote.ruleVersion, ...vote.quote.cost },
    }),
    "bypass",
  );
  await expect(
    postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true })(
      user("a"),
      "bypass",
      direct,
      { receiptId: null, jobId: crypto.randomUUID(), shard: 0 },
    ),
  ).rejects.toThrow("faction vote");

  const before = (await live.read(user("a"), match)) as any;
  await live.command(user("a"), match, "post-proposal-edit", "push", {
    epoch: before.document.epoch,
    version: 1,
    updates: [
      { clientID: "a-tab", changes: ChangeSet.of({ from: 4, insert: "later" }, 4).toJSON() },
    ],
  });
  await live.command(user("b"), match, "paid-approve", "vote", { id: vote.id, approve: true });
  await live.command(user("b"), match, "paid-approve", "vote", { id: vote.id, approve: true });
  const rows = await pool.query("SELECT id,source,owner_id FROM submissions WHERE match_id=$1", [
    match,
  ]);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].source).toBe("abc!");
  expect(rows.rows[0].owner_id).toBe("b");
  const job = (
    await pool.query(
      "SELECT j.id FROM execution_jobs j JOIN execution_dispatch_intents i ON i.job_id=j.id WHERE j.submission_id=$1",
      [rows.rows[0].id],
    )
  ).rows[0];
  expect(job).toBeTruthy();
  expect(await postgresDispatch(run).claim("execution", 1, 30000)).toMatchObject([
    { jobId: job.id },
  ]);

  const events = await pool.query(
    "SELECT seconds,competitor_id FROM match_rule_events WHERE match_id=$1 AND kind='submission'",
    [match],
  );
  expect(events.rows).toEqual([{ seconds: 10, competitor_id: "team:1" }]);
  const unlimited = matchPreset("strict");
  unlimited.submissions.freeSubmissions = null;
  const allowance = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      prepareRuleAction(tx, match, "a", unlimited, { kind: "submission" }),
    ),
  );
  expect(allowance.quote.seconds).toBe(0);
  expect(allowance.quote.cooldownSeconds).toBeGreaterThan(0);
  const results = submissionSnapshots(run);
  const teammate = await results.read(user("a"), rows.rows[0].id);
  // Streams reauthorize on consumption as well as creation.
  const reader = teammate.getReader();
  while (!(await reader.read()).done) {}
  await expect(results.read(user("c"), rows.rows[0].id)).rejects.toThrow();
});
test("direct paid reveal cannot bypass team vote", async () => {
  await expect(
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const rules = matchPreset("strict");
        const plan = await prepareRuleAction(tx, match, "a", rules, { kind: "topics" });
        await executeRuleAction(tx, match, "a", rules, { kind: "topics", approval: plan.quote });
      }),
    ),
  ).rejects.toThrow("faction vote");
  const vote = (await live.command(user("a"), match, "reveal-proposal", "propose", {
    action: { kind: "reveal", target: "topics" },
  })) as any;
  const originalDeadline = (
    await pool.query("SELECT deadline::text FROM matches WHERE id=$1", [match])
  ).rows[0].deadline;
  await pool.query(
    "UPDATE matches SET deadline=clock_timestamp()+make_interval(secs=>$2) WHERE id=$1",
    [match, vote.quote.cost.seconds + 10],
  );
  await expect(
    live.command(user("b"), match, "reveal-approve", "vote", { id: vote.id, approve: true }),
  ).rejects.toThrow("time penalty must be less than your remaining submission time");
  const saved = await pool.query("SELECT vote FROM team_votes WHERE id=$1", [vote.id]);
  expect(saved.rows[0].vote).toMatchObject({ state: "pending", ballots: { [ids.a!]: true } });
  expect(saved.rows[0].vote.ballots).not.toHaveProperty(ids.b!);
  const charged = await pool.query(
    "SELECT 1 FROM match_rule_events WHERE match_id=$1 AND kind='topics'",
    [match],
  );
  expect(charged.rows).toHaveLength(0);
  await pool.query("UPDATE matches SET deadline=$2 WHERE id=$1", [match, originalDeadline]);
  await live.command(user("b"), match, "reveal-approve", "vote", { id: vote.id, approve: true });
  expect(
    (
      await pool.query(
        "SELECT competitor_id FROM match_rule_events WHERE match_id=$1 AND kind='topics'",
        [match],
      )
    ).rows,
  ).toEqual([{ competitor_id: "team:1" }]);
});

test("private lobby organizes uneven teams and starts shared workspaces", async () => {
  const parties = partyRepository(
    run,
    new Uint8Array(32),
    { prearm: async () => {}, wake: async () => {} },
    1,
    prearmReceipts(run),
    true,
  );
  const created = (await parties.create(
    user("a"),
    "teams-lobby",
    normalizePartySettings({
      mode: "factions",
      durationMinutes: 30,
      difficulties: ["easy"],
      selectedProblemVersionId: version,
      rules: matchPreset("casual"),
    }),
  )) as any;
  const id = created.party.id;
  for (const actor of ["b", "c"])
    await parties.join(user(actor), "join-lobby", created.inviteUrl.slice("/invite/".length));
  const initial = (await live.lobby(user("a"), id)) as TeamLobby;
  expect(initial.assignments.every((member) => member.team !== null)).toBe(true);
  await expect(
    live.organize(user("a"), id, "unassign-rejected", {
      action: "assign",
      userId: ids.c,
      team: null,
    }),
  ).rejects.toThrow("Invalid faction");
  await expect(
    live.organize(user("b"), id, "nonhost-create", { action: "create" }),
  ).rejects.toMatchObject({ status: 403 });
  const added = (await live.organize(user("a"), id, "add-third", {
    action: "create",
  })) as TeamLobby;
  expect(added.teamCount).toBe(3);
  expect(added.assignments).toEqual(initial.assignments);
  await live.organize(user("a"), id, "add-fourth", { action: "create" });
  await expect(live.organize(user("a"), id, "add-fifth", { action: "create" })).rejects.toThrow();
  await live.organize(user("a"), id, "occupy-third", { action: "assign", userId: ids.c, team: 3 });
  const reduced = (await live.organize(user("a"), id, "remove-occupied", {
    action: "delete",
    team: 3,
  })) as TeamLobby;
  expect(reduced.teamCount).toBe(3);
  expect(reduced.assignments.every((member) => member.team !== null && member.team <= 3)).toBe(
    true,
  );
  await live.organize(user("a"), id, "remove-third", { action: "delete", team: 3 });
  await expect(
    live.organize(user("a"), id, "remove-below-minimum", { action: "delete", team: 1 }),
  ).rejects.toThrow();
  await expect(
    live.organize(user("b"), id, "nonhost-lock", { action: "lock", locked: true }),
  ).rejects.toMatchObject({ status: 403 });
  await live.organize(user("a"), id, "host-lock", { action: "lock", locked: true });
  await expect(
    live.organize(user("b"), id, "locked-own-move", { action: "assign", userId: ids.b, team: 2 }),
  ).rejects.toMatchObject({ status: 403 });
  await live.organize(user("a"), id, "host-locked-move", {
    action: "assign",
    userId: ids.b,
    team: 2,
  });
  await live.organize(user("a"), id, "host-unlock", { action: "lock", locked: false });
  await live.organize(user("a"), id, "choose-a", { action: "assign", userId: ids.a, team: 1 });
  await live.organize(user("b"), id, "choose-b", { action: "assign", userId: ids.b, team: 1 });
  await expect(
    live.organize(user("b"), id, "move-c", { action: "assign", userId: ids.c, team: 2 }),
  ).rejects.toThrow();
  await live.organize(user("a"), id, "host-move-c", { action: "assign", userId: ids.c, team: 2 });
  const blue = "Blue 👩🏽‍💻";
  const named = (await live.organize(user("b"), id, "name-own", {
    action: "rename",
    team: 1,
    name: ` ${blue} `,
  })) as TeamLobby;
  expect(named.names?.[0]).toBe(blue);
  await expect(
    live.organize(user("b"), id, "name-other", { action: "rename", team: 2, name: "Other" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    live.organize(user("a"), id, "name-blank", { action: "rename", team: 1, name: " " }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    live.organize(user("a"), id, "name-duplicate", {
      action: "rename",
      team: 2,
      name: blue.toLowerCase(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    live.organize(user("a"), id, "name-long", { action: "rename", team: 2, name: "x".repeat(41) }),
  ).rejects.toMatchObject({ status: 400 });
  for (const name of ["Gold!", "Gold\u200d", "Gold\n", "Gold  2"])
    await expect(
      live.organize(user("a"), id, `invalid-${name}`, { action: "rename", team: 2, name }),
    ).rejects.toMatchObject({ status: 400 });
  await live.organize(user("a"), id, "name-lock", { action: "lock", locked: true });
  await expect(
    live.organize(user("b"), id, "name-locked-member", {
      action: "rename",
      team: 1,
      name: "Blocked",
    }),
  ).rejects.toMatchObject({ status: 403 });
  await live.organize(user("a"), id, "name-locked-host", {
    action: "rename",
    team: 2,
    name: "Gold",
  });
  expect(((await live.lobby(user("b"), id)) as TeamLobby).names).toEqual([blue, "Gold"]);
  await live.organize(user("a"), id, "name-unlock", { action: "lock", locked: false });
  await live.organize(user("a"), id, "empty-third", { action: "create" });
  for (const actor of ["a", "b", "c"]) await parties.heartbeat(user(actor), crypto.randomUUID());
  await expect(parties.mutate(user("a"), id, "ready-empty", "ready", true)).rejects.toMatchObject({
    status: 409,
  });
  await parties.mutate(user("a"), id, "unready-empty", "ready", false);
  // Start independently rechecks occupancy even if readiness was previously recorded.
  await pool.query("UPDATE party_members SET ready=true WHERE party_id=$1", [id]);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  expect(await parties.read(user("a"), id)).toMatchObject({
    currentMatchId: null,
    queueError: expect.any(String),
  });
  expect(
    (await pool.query("SELECT current_match_id FROM parties WHERE id=$1", [id])).rows[0]
      .current_match_id,
  ).toBeNull();
  await live.organize(user("a"), id, "delete-empty-third", { action: "delete", team: 3 });
  for (const actor of ["a", "b", "c"])
    await parties.mutate(user(actor), id, "ready-before-move", "ready", true);
  await live.organize(user("a"), id, "move-clears-ready", {
    action: "assign",
    userId: ids.c,
    team: 1,
  });
  const moved = await pool.query("SELECT ready FROM party_members WHERE party_id=$1", [id]);
  expect(moved.rows.every((member) => !member.ready)).toBe(true);
  await live.organize(user("a"), id, "restore-occupied", {
    action: "assign",
    userId: ids.c,
    team: 2,
  });
  for (const actor of ["a", "b", "c"])
    await parties.mutate(user(actor), id, "ready-filled", "ready", true);
  await live.organize(user("b"), id, "name-preserves-ready", {
    action: "rename",
    team: 1,
    name: "Azure",
  });
  expect(await parties.read(user("a"), id)).toMatchObject({
    members: [{ ready: true }, { ready: true }, { ready: true }],
  });
  for (const locked of [true, false]) {
    await live.organize(user("a"), id, `ready-lock-${locked}`, { action: "lock", locked });
    expect(await parties.read(user("a"), id)).toMatchObject({
      settings: { factionChangesLocked: locked },
      members: [{ ready: true }, { ready: true }, { ready: true }],
    });
  }
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND countdown_ends_at IS NOT NULL",
    [id],
  );
  const { currentMatchId: round } = (await parties.read(user("a"), id)) as {
    currentMatchId: string;
  };
  expect(round).toBeTruthy();
  expect(
    (await pool.query("SELECT faction_names FROM matches WHERE id=$1", [round])).rows[0]
      .faction_names,
  ).toEqual(["Azure", "Gold"]);
  const a = (await live.read(user("a"), round)) as any,
    b = (await live.read(user("b"), round)) as any,
    c = (await live.read(user("c"), round)) as any;
  expect(a.workspaceId).toBe(b.workspaceId);
  expect(a.workspaceId).not.toBe(c.workspaceId);
  expect(a.document.source).toContain("def ");
  await expect(live.organize(user("a"), id, "midround", { action: "balance" })).rejects.toThrow();
  const languageVote = (await live.command(user("a"), round, "language-proposal", "propose", {
    action: {
      kind: "language",
      language: "java",
      documentEpoch: a.document.epoch,
      documentVersion: a.document.version,
    },
  })) as any;
  await live.command(user("b"), round, "language-approve", "vote", {
    id: languageVote.id,
    approve: true,
  });
  const changed = (await live.read(user("b"), round)) as any;
  expect(changed.workspaceId).not.toBe(a.workspaceId);
  expect(changed.language).toBe("java");
  expect(changed.document.epoch).not.toBe(a.document.epoch);
  expect(
    (await pool.query("SELECT language FROM workspaces WHERE id=$1", [a.workspaceId])).rows[0]
      .language,
  ).toBe("python");
  const vote = (await live.command(user("c"), round, "solo-concede", "propose", {
    action: { kind: "concede" },
  })) as any;
  expect(vote.state).toBe("executed");
  expect(
    (await pool.query("SELECT outcome FROM matches WHERE id=$1", [round])).rows[0].outcome
      .winnerTeam,
  ).toBe(1);
  await parties.join(user("d"), "join-after-win", created.inviteUrl.slice("/invite/".length));
  const after = (await parties.read(user("d"), id)) as {
    members: { userId: string; previousWinner?: boolean }[];
  };
  expect(
    after.members.filter((member) => member.previousWinner).map((member) => member.userId),
  ).toEqual([ids.a, ids.b]);
});
