/** @file integration.test.ts @description Disposable party presence and command checks. @module parties */
import { afterAll, beforeAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { languageRuntime } from "@quorem/execution";
import { persistQuestionVersion } from "../problems/publication.ts";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { partyRepository, reconcileParty } from "./repository.ts";
import { prearmReceipts } from "../events/scheduling/prearm.ts";
import { postgresDeadlines } from "../events/scheduling/deadlines.ts";
const url = process.env.QUOREM_PARTY_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/quorem_hono_lifecycle_test")
  throw new Error("Disposable party database required");
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
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
const repo = partyRepository(
  run,
  new Uint8Array(32),
  { prearm: async () => {}, wake: async () => {} },
  1,
  prearmReceipts(run),
);
const user = (id: string) => ({
  kind: "local" as const,
  userId: id,
  displayName: id,
  admin: false,
  emailVerified: true,
  sessionId: id,
  strongUntil: 0,
});
beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("migrations"));
  await pool.query(
    "INSERT INTO users(id,participant_id,display_name,kind) VALUES ('party-a',gen_random_uuid(),'A','account'),('party-b',gen_random_uuid(),'B','account'),('party-c',gen_random_uuid(),'C','account'),('party-d',gen_random_uuid(),'D','account')",
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../fixtures/problems/run-widths.json", import.meta.url),
      "utf8",
    ),
  );
  const problem = crypto.randomUUID(),
    version = crypto.randomUUID();
  Object.assign(fixture.problem, { id: version, slug: "party-fixture", version: "1" });
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,'party-fixture')`);
      await persistQuestionVersion(
        tx,
        JSON.stringify(fixture),
        problem,
        version,
        1,
        null,
        (language) => {
          const r = languageRuntime(language);
          return r ? { revision: r.revision, harness: r.harness } : undefined;
        },
      );
    }),
  );
});
afterAll(async () => {
  await pool.end();
});
test("members share presence, readiness, and offline cleanup", async () => {
  const settings = {
    questionFilters: {},
    admissionLocked: false,
    accessMode: "accounts_only",
    mode: "showdown",
    difficulties: ["easy"],
    rules: { clipboard: "off", focus: "off" },
    difficulty: "easy",
    durationMinutes: 30,
    shareCodeAfterMatch: true,
  };
  const a = user("party-a"),
    b = user("party-b");
  const created = (await repo.create(a, "create", settings)) as {
    party: { id: string };
    inviteUrl: string;
  };
  const id = created.party.id;
  await repo.heartbeat(a, crypto.randomUUID());
  await repo.join(b, "join", created.inviteUrl.slice("/invite/".length));
  await repo.heartbeat(b, crypto.randomUUID());
  await repo.mutate(a, id, "ready", "ready", true);
  const party = (await repo.mutate(b, id, "ready", "ready", true)) as {
    members: { ready: boolean; online: boolean }[];
  };
  expect(party.members.every((x) => x.ready && x.online)).toBe(true);
  await pool.query(
    "UPDATE platform_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id='party-b'",
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileParty(tx, id),
    ),
  );
  const snapshot = (await repo.read(a, id)) as { members: { ready: boolean; online: boolean }[] };
  expect(snapshot.members.filter((x) => !x.online)[0].ready).toBe(false);
  await pool.query(
    "UPDATE party_members SET last_seen_at=clock_timestamp()-interval '6 minutes' WHERE owner_id='party-b'",
  );
  const candidates = await postgresDeadlines(run).candidates(0, 1, 32);
  expect(candidates.some((x) => x.id === `party:${id}`)).toBe(true);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileParty(tx, id),
    ),
  );
  expect(((await repo.read(a, id)) as { members: unknown[] }).members).toHaveLength(1);
});

test("completion resets readiness and requeue freezes settings exactly once", async () => {
  const settings = {
    questionFilters: {},
    admissionLocked: false,
    accessMode: "accounts_only",
    mode: "showdown",
    difficulties: ["easy"],
    rules: { clipboard: "off", focus: "off" },
    difficulty: "easy",
    durationMinutes: 30,
    shareCodeAfterMatch: true,
  };
  const c = user("party-c"),
    d = user("party-d");
  const created = (await repo.create(c, "create", settings)) as {
    party: { id: string };
    inviteUrl: string;
  };
  const id = created.party.id;
  await repo.heartbeat(c, crypto.randomUUID());
  await repo.join(d, "join", created.inviteUrl.slice(8));
  await repo.heartbeat(d, crypto.randomUUID());
  await repo.mutate(c, id, "ready-1", "ready", true);
  await repo.mutate(d, id, "ready-1", "ready", true);
  const started = (await repo.mutate(c, id, "start", "start", null)) as { currentMatchId: string };
  const first = started.currentMatchId;
  expect(
    (await pool.query("SELECT share_code_after_match FROM matches WHERE id=$1", [first])).rows[0]
      .share_code_after_match,
  ).toBe(true);
  await pool.query(
    'UPDATE matches SET state=\'completed\',completed_at=clock_timestamp(),outcome=\'{"kind":"draw","reason":"deadline_score"}\'::jsonb WHERE id=$1',
    [first],
  );
  await pool.query("DELETE FROM match_reservations WHERE match_id=$1", [first]);
  const complete = (await repo.read(c, id)) as {
    latestMatchId: string;
    members: { ready: boolean }[];
  };
  expect(complete.latestMatchId).toBe(first);
  expect(complete.members.every((x) => !x.ready)).toBe(true);
  await repo.mutate(c, id, "settings", "settings", { ...settings, shareCodeAfterMatch: false });
  await repo.mutate(c, id, "ready-2", "ready", true);
  const queued = (await repo.mutate(d, id, "ready-2", "ready", true)) as {
    countdownEndsAt: string | null;
  };
  expect(queued.countdownEndsAt).not.toBeNull();
  await repo.mutate(c, id, "unready", "ready", false);
  expect(
    ((await repo.read(c, id)) as { countdownEndsAt: string | null }).countdownEndsAt,
  ).toBeNull();
  await repo.mutate(c, id, "ready-3", "ready", true);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  await Promise.all(
    [1, 2].map(() =>
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
          reconcileParty(tx, id),
        ),
      ),
    ),
  );
  const result = await pool.query(
    "SELECT id,share_code_after_match FROM matches WHERE party_id=$1 ORDER BY started_at",
    [id],
  );
  expect(result.rows).toHaveLength(2);
  expect(result.rows.map((x) => x.share_code_after_match)).toEqual([true, false]);
});
