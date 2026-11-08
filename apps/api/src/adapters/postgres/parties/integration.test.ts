import { matchPreset } from "@quorem/contracts/match-rules";
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
import { newGuestToken, guestTokenHash } from "../../../modules/identity/guest/credentials.ts";
import { guestRepository } from "../identity/guest.ts";
import { normalizePartySettings } from "../../../modules/parties/model.ts";
import { partyRepository, reconcileParty } from "./repository.ts";
import { prearmReceipts } from "../events/scheduling/prearm.ts";
import { postgresDeadlines } from "../events/scheduling/deadlines.ts";
const url = process.env.QUOREM_PARTY_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/quorem_hono_party_test")
  throw new Error("Disposable party database required");
assertRunnerFixture(url, ["/quorem_hono_party_test"]);
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
  true,
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
    "INSERT INTO users(id,participant_id,display_name,kind) VALUES ('party-a',gen_random_uuid(),'A','account'),('party-b',gen_random_uuid(),'B','account'),('party-c',gen_random_uuid(),'C','account'),('party-d',gen_random_uuid(),'D','account'),('party-e',gen_random_uuid(),'E','account'),('party-f',gen_random_uuid(),'F','account'),('party-g',gen_random_uuid(),'G','account')",
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
    rules: matchPreset("casual"),
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
  const firstWindow = crypto.randomUUID(),
    secondWindow = crypto.randomUUID();
  await repo.heartbeat(b, firstWindow);
  await repo.heartbeat(b, secondWindow);
  await repo.mutate(a, id, "ready", "ready", true);
  const party = (await repo.mutate(b, id, "ready", "ready", true)) as {
    members: { ready: boolean; online: boolean }[];
  };
  expect(party.members.every((x) => x.ready && x.online)).toBe(true);
  await pool.query(
    "UPDATE platform_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE window_id=$1",
    [firstWindow],
  );
  const stillOnline = (await repo.read(a, id)) as {
    members: { ready: boolean; online: boolean }[];
  };
  expect(stillOnline.members.every((x) => x.ready && x.online)).toBe(true);

  await pool.query(
    "UPDATE platform_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id='party-b'",
  );
  await repo.heartbeat(b, secondWindow);
  const snapshot = (await repo.read(a, id)) as { members: { ready: boolean; online: boolean }[] };
  expect(snapshot.members.find((x) => !x.ready)?.online).toBe(true);
  expect(snapshot.members.filter((x) => x.ready && x.online)).toHaveLength(1);
  await pool.query(
    "UPDATE platform_presence_leases SET expires_at=clock_timestamp()-interval '7 minutes' WHERE owner_id='party-b'",
  );
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
    rules: matchPreset("casual"),
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
  const firstQueued = (await repo.mutate(d, id, "ready-1", "ready", true)) as {
    currentMatchId: string | null;
    latestMatchId: string | null;
    countdownEndsAt: string;
  };
  expect(firstQueued.currentMatchId).toBeNull();
  expect(firstQueued.latestMatchId).toBeNull();
  expect(Date.parse(firstQueued.countdownEndsAt)).toBeGreaterThan(Date.now());
  await pool.query("UPDATE parties SET countdown_ends_at=NULL WHERE id=$1", [id]);
  expect(await repo.read(c, id)).toMatchObject({
    currentMatchId: null,
    countdownEndsAt: expect.any(String),
  });
  expect(await repo.mutate(c, id, "cancel-first", "ready", false)).toMatchObject({
    currentMatchId: null,
    countdownEndsAt: null,
  });
  await repo.mutate(c, id, "restart-first", "ready", true);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND countdown_ends_at IS NOT NULL",
    [id],
  );
  const { currentMatchId: first } = (await repo.read(c, id)) as { currentMatchId: string };
  expect(first).toBeTruthy();
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
  const nextSettings = normalizePartySettings({
    ...settings,
    shareCodeAfterMatch: false,
    questionSelection: "recommended",
  });
  expect(await repo.mutate(c, id, "settings", "settings", nextSettings)).toMatchObject({
    settings: { questionSelection: "recommended" },
  });
  await repo.mutate(c, id, "ready-2", "ready", true);
  const queued = (await repo.mutate(d, id, "ready-2", "ready", true)) as {
    countdownEndsAt: string | null;
    version: string;
  };
  expect(queued.countdownEndsAt).not.toBeNull();
  for (const admissionLocked of [true, false]) {
    const updated = (await repo.mutate(c, id, `joining-${admissionLocked}`, "settings", {
      ...nextSettings,
      admissionLocked,
    })) as { settings: { admissionLocked: boolean }; version: string };
    expect(updated).toMatchObject({
      settings: { admissionLocked },
      members: [{ ready: true }, { ready: true }],
      countdownEndsAt: queued.countdownEndsAt,
      version: (BigInt(queued.version) + (admissionLocked ? 1n : 2n)).toString(),
    });
  }
  const everyone = normalizePartySettings({
    ...nextSettings,
    rules: { ...settings.rules, settingsEditors: "everyone" },
  });
  const permissions = await repo.mutate(c, id, "everyone-edits", "settings", everyone);
  expect(permissions).toMatchObject({
    settings: { rules: { settingsEditors: "everyone" } },
    members: [{ ready: true }, { ready: true }],
    countdownEndsAt: queued.countdownEndsAt,
  });
  expect(await repo.mutate(c, id, "same-settings", "settings", everyone)).toEqual(permissions);
  const sharesCode = { ...everyone, shareCodeAfterMatch: true };
  expect(await repo.mutate(c, id, "enable-sharing", "settings", sharesCode)).toMatchObject({
    members: [{ ready: false }, { ready: false }],
    countdownEndsAt: null,
  });
  await repo.mutate(c, id, "ready-after-sharing", "ready", true);
  await repo.mutate(d, id, "ready-after-sharing", "ready", true);
  expect(await repo.mutate(c, id, "disable-sharing", "settings", everyone)).toMatchObject({
    members: [{ ready: true }, { ready: true }],
  });
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
    `SELECT m.id,m.share_code_after_match,m.question_selection,r.match_id IS NOT NULL AS recommended
     FROM matches m LEFT JOIN recommendation_match_selections r ON r.match_id=m.id
     WHERE party_id=$1 ORDER BY started_at`,
    [id],
  );
  expect(result.rows).toHaveLength(2);
  expect(result.rows).toMatchObject([
    { share_code_after_match: true, question_selection: "random", recommended: false },
    { share_code_after_match: false, question_selection: "recommended", recommended: true },
  ]);
});

test("host transfer, guest re-entry and requeue errors preserve authorization", async () => {
  for (const owner of ["party-e", "party-f"])
    await pool.query(
      "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'matches.host_guests','manual',$3,'fixture','test')",
      [crypto.randomUUID(), owner, owner],
    );
  const settings = {
    questionFilters: {},
    admissionLocked: false,
    accessMode: "guests_allowed",
    mode: "free-for-all",
    difficulties: ["hard"],
    rules: matchPreset("casual"),
    difficulty: "hard",
    durationMinutes: 30,
    shareCodeAfterMatch: true,
  };
  const paused = partyRepository(
    run,
    new Uint8Array(32),
    { prearm: async () => {}, wake: async () => {} },
    1,
    prearmReceipts(run),
    false,
  );
  await expect(paused.create(user("party-e"), "paused", settings)).rejects.toMatchObject({
    code: "guest_hosting_paused",
  });
  const e = user("party-e"),
    f = user("party-f"),
    created = (await repo.create(e, "create", settings)) as {
      party: { id: string };
      inviteUrl: string;
    };
  const id = created.party.id,
    token = created.inviteUrl.slice(8),
    credential = newGuestToken();
  await repo.heartbeat(e, crypto.randomUUID());
  await repo.join(f, "join", token);
  await repo.heartbeat(f, crypto.randomUUID());
  const preview = await repo.preview(token);
  expect(preview).toEqual({
    id,
    guestAllowed: true,
    participantCount: 2,
    capacity: 8,
    matchSetup: {
      mode: settings.mode,
      difficulties: settings.difficulties,
      durationMinutes: settings.durationMinutes,
      rules: settings.rules,
      shareCodeAfterMatch: settings.shareCodeAfterMatch,
    },
  });
  await repo.joinGuest(token, credential, "Guest");
  const hash = await guestTokenHash(credential);
  const guest = await run((scope) => guestRepository(scope).lookup("match", hash));
  if (!guest) throw new Error("guest missing");
  await repo.heartbeat(guest, crypto.randomUUID());
  await repo.mutate(e, id, "leave", "leave", null);
  const publicF = (
    await pool.query("SELECT participant_id::text AS id FROM users WHERE id='party-f'")
  ).rows[0].id;
  expect(((await repo.read(f, id)) as { hostUserId: string }).hostUserId).toBe(publicF);
  await repo.mutate(guest, id, "leave", "leave", null);
  expect(((await repo.current(guest)) as { party: unknown }).party).toBeNull();
  await repo.joinGuest(token, credential, "Guest");
  await repo.heartbeat(guest, crypto.randomUUID());
  const previous = (await pool.query("SELECT id FROM matches LIMIT 1")).rows[0].id;
  await pool.query("UPDATE parties SET latest_match_id=$1 WHERE id=$2", [previous, id]);
  await repo.mutate(f, id, "ready-f", "ready", true);
  await repo.mutate(guest, id, "ready-g", "ready", true);
  const deadline = ((await repo.read(f, id)) as { countdownEndsAt: string }).countdownEndsAt;
  await repo.mutate(guest, id, "ready-again", "ready", true);
  expect(((await repo.read(f, id)) as { countdownEndsAt: string }).countdownEndsAt).toBe(deadline);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileParty(tx, id),
    ),
  );
  const failed = (await repo.read(f, id)) as {
    queueError: string | null;
    members: { ready: boolean }[];
  };
  expect(failed.queueError).toBeTruthy();
  expect(failed.members.every((x) => !x.ready)).toBe(true);
  await repo.mutate(f, id, "easy-settings", "settings", {
    ...settings,
    difficulty: "easy",
    difficulties: ["easy"],
  });
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES('party-f',$1)", [
    previous,
  ]);
  await repo.mutate(f, id, "busy-f", "ready", true);
  await repo.mutate(guest, id, "busy-guest", "ready", true);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileParty(tx, id),
    ),
  );
  expect(((await repo.read(f, id)) as { queueError: string | null }).queueError).toContain(
    "another match",
  );
  await pool.query("DELETE FROM match_reservations WHERE owner_id='party-f'");

  await repo.mutate(f, id, "ready-after-error", "ready", true);
  await repo.mutate(guest, id, "ready-before-revoke", "ready", true);
  await pool.query("UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1", [
    hash,
  ]);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileParty(tx, id),
    ),
  );
  expect(((await repo.read(f, id)) as { queueError: string | null }).queueError).toContain(
    "expired",
  );

  await pool.query("UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1", [
    await guestTokenHash(credential),
  ]);
  await expect(repo.joinGuest(token, credential, "Guest")).rejects.toMatchObject({ status: 401 });
});

test("guest identity locks do not block party reads or durable round start", async () => {
  const owner = user("party-g");
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'party-g','matches.host_guests','manual','race','fixture','test')",
    [crypto.randomUUID()],
  );
  const settings = {
    questionFilters: {},
    admissionLocked: false,
    accessMode: "guests_allowed",
    mode: "showdown",
    difficulties: ["easy"],
    rules: matchPreset("casual"),
    difficulty: "easy",
    durationMinutes: 30,
    shareCodeAfterMatch: true,
  };
  const created = (await repo.create(owner, "create-race", settings)) as {
    party: { id: string };
    inviteUrl: string;
  };
  const id = created.party.id,
    token = created.inviteUrl.slice(8),
    credential = newGuestToken(),
    hash = await guestTokenHash(credential);
  await repo.heartbeat(owner, crypto.randomUUID());
  await repo.joinGuest(token, credential, "Guest");
  const guest = await run((scope) => guestRepository(scope).lookup("match", hash));
  if (!guest) throw new Error("guest missing");
  await repo.heartbeat(guest, crypto.randomUUID());
  await repo.mutate(owner, id, "ready-owner", "ready", true);
  await repo.mutate(guest, id, "ready-guest", "ready", true);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND countdown_ends_at IS NOT NULL",
    [id],
  );
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [guest.userId]);
    await blocker.query("SELECT token_hash FROM guest_sessions WHERE token_hash=$1 FOR UPDATE", [
      hash,
    ]);
    const work = run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        reconcileParty(tx, id),
      ),
    );
    const completed = await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 750)),
    ]);
    expect(completed).toBe(true);
    await work;
    // Complete the guest reader's normal identity -> party lock sequence.
    const party = (
      await blocker.query(
        "SELECT countdown_ends_at,queue_error,(SELECT bool_and(ready) FROM party_members WHERE party_id=$1) AS all_ready FROM parties WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    expect(party.countdown_ends_at).not.toBeNull();
    expect(party.queue_error).toBeNull();
    expect(party.all_ready).toBe(true);
    await blocker.query("ROLLBACK");
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        reconcileParty(tx, id),
      ),
    );
    expect(
      ((await repo.read(guest, id)) as { currentMatchId: string | null }).currentMatchId,
    ).toBeTruthy();
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("disbanded guest has no current party but retains the live credential", async () => {
  const owner = `party-disband-${crypto.randomUUID()}`;
  await pool.query(
    "INSERT INTO users(id,participant_id,display_name,kind) VALUES($1,gen_random_uuid(),'Owner','account')",
    [owner],
  );
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'matches.host_guests','manual',$3,'fixture','test')",
    [crypto.randomUUID(), owner, crypto.randomUUID()],
  );
  const created = (await repo.create(
    user(owner),
    "create",
    normalizePartySettings({
      difficulty: "easy",
      durationMinutes: 30,
      accessMode: "guests_allowed",
    }),
  )) as { party: { id: string }; inviteUrl: string };
  const token = created.inviteUrl.split("/").at(-1)!;
  const credential = newGuestToken();
  await repo.joinGuest(token, credential, "Guest");
  const hash = await guestTokenHash(credential);
  const guest = await run((scope) => guestRepository(scope).lookup("match", hash));
  if (!guest) throw new Error("guest missing");
  await repo.mutate(user(owner), created.party.id, "disband", "disband", null);
  expect(((await repo.current(guest)) as { party: unknown }).party).toBeNull();
  await expect(repo.read(guest, created.party.id)).rejects.toMatchObject({ status: 404 });
  expect(await run((scope) => guestRepository(scope).lookup("match", hash))).not.toBeNull();
  await pool.query("UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1", [
    hash,
  ]);
  await expect(repo.current(guest)).rejects.toMatchObject({ status: 404 });
});

test("only hosts remove lobby members, reset readiness, and replay safely", async () => {
  const host = user(`kick-host-${crypto.randomUUID()}`);
  const member = user(`kick-member-${crypto.randomUUID()}`);
  const target = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users(id,participant_id,display_name,kind) VALUES($1,gen_random_uuid(),'Host','account'),($2,$3,'Member','account')",
    [host.userId, member.userId, target],
  );
  const created = (await repo.create(
    host,
    "create",
    normalizePartySettings({ difficulty: "easy", durationMinutes: 30 }),
  )) as { party: { id: string }; inviteUrl: string };
  const id = created.party.id;
  await repo.join(member, "join", created.inviteUrl.split("/").at(-1)!);
  await expect(repo.mutate(member, id, "not-host", "kick", target)).rejects.toMatchObject({
    status: 403,
  });
  const hostId = (await pool.query("SELECT participant_id FROM users WHERE id=$1", [host.userId]))
    .rows[0].participant_id;
  await expect(repo.mutate(host, id, "self", "kick", hostId)).rejects.toMatchObject({
    status: 404,
  });
  await repo.heartbeat(host, crypto.randomUUID());
  await repo.heartbeat(member, crypto.randomUUID());
  await pool.query("UPDATE party_members SET ready=true WHERE party_id=$1", [id]);
  const result = (await repo.mutate(host, id, "kick", "kick", target)) as {
    members: { ready: boolean }[];
  };
  expect(result.members).toHaveLength(1);
  expect(result.members[0].ready).toBe(false);
  await expect(repo.read(member, id)).rejects.toMatchObject({ status: 404 });
  expect(await repo.mutate(host, id, "kick", "kick", target)).toEqual(result);
  await repo.mutate(
    host,
    id,
    "lock-joining",
    "settings",
    normalizePartySettings({ difficulty: "easy", durationMinutes: 30, admissionLocked: true }),
  );
  await expect(
    repo.join(member, "locked-rejoin", created.inviteUrl.split("/").at(-1)!),
  ).rejects.toMatchObject({ status: 409 });
  await repo.mutate(
    host,
    id,
    "unlock-joining",
    "settings",
    normalizePartySettings({ difficulty: "easy", durationMinutes: 30 }),
  );
  await repo.join(member, "rejoin", created.inviteUrl.split("/").at(-1)!);
  await repo.mutate(host, id, "host-ready", "ready", true);
  await repo.mutate(member, id, "member-ready", "ready", true);
  await pool.query(
    "UPDATE parties SET countdown_ends_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND countdown_ends_at IS NOT NULL",
    [id],
  );
  expect((await repo.read(host, id)) as { currentMatchId: string }).toMatchObject({
    currentMatchId: expect.any(String),
  });
  await expect(repo.mutate(host, id, "active-kick", "kick", target)).rejects.toMatchObject({
    status: 409,
  });
});
