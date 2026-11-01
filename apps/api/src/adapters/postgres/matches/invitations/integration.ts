/** @file integration.ts @description Disposable match invitation integration. @module matches */
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { createApp } from "../../../../app.ts";
import { matchInvitationRoutes } from "../../../../modules/matches/invitations/routes.ts";
import { IdentityError } from "../../../../modules/identity/model.ts";
import { publicGuestBudget } from "../../identity/guest.ts";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { newGuestToken } from "../../../../modules/identity/guest/credentials.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import { drainDeadlines } from "../../../../modules/events/scheduling/scheduling.ts";
import { nodeCoordinator } from "../../../scheduling/shells.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresDeadlines } from "../../events/scheduling/deadlines.ts";
import { reconcileScheduledMatch } from "../reconcile/repository.ts";
import { matchLifecycle } from "../lifecycle/repository.ts";
import { matchInvitations } from "./repository.ts";
import { matchLanguageSelection } from "../selection/language.ts";
import { selectMatchCandidate } from "../selection/repository.ts";
const url = process.env.QUOREM_MATCH_INVITES_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).port !== "55471" ||
  new URL(url).pathname !== "/quorem_hono_invites_test" ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
)
  throw new Error("Disposable invitation database required");
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
  (error) => schedulerErrors.push(error),
);
const key = new Uint8Array(32).fill(3),
  lifecycle = matchLifecycle(run, {
    inviteKey: key,
    receipts,
    coordinator,
    shards: 1,
    guestCreation: true,
  }),
  invites = matchInvitations(run, key),
  language = matchLanguageSelection(run, key);
const principal = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: userId,
  strongUntil: 0,
});
const host = principal("inv-host"),
  a = principal("inv-a"),
  b = principal("inv-b");
const version = crypto.randomUUID(),
  problem = crypto.randomUUID();
const guestSettings = normalizeSettings({ difficulty: "easy", accessMode: "guests_allowed" }),
  accountSettings = normalizeSettings({ difficulty: "easy" });
const raw = (url: string) => url.slice("/invite/".length);
async function room(settings = accountSettings) {
  return (await lifecycle.create(host, crypto.randomUUID(), settings)) as {
    id: string;
    inviteUrl: string;
  };
}
async function close(id: string) {
  await lifecycle.mutate(host, id, crypto.randomUUID(), "leave", null);
}
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES('inv-host','Host','account'),('inv-a','A','account'),('inv-b','B','account')",
  );
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'inv-host','matches.host_guests','manual','grant','fixture','test')",
    [crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO problems(id,slug,owner_id) VALUES($1,'private-invite','inv-host')",
    [problem],
  );
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Private','easy','','{}','[]','{}','test')",
    [version, problem],
  );
  for (const l of ["python", "java"])
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,$2,'','runtime','harness','')",
      [version, l],
    );
  await pool.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [problem, version]);
  await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [version]);
});
after(async () => {
  coordinator.close();
  while (active) await new Promise((resolve) => setTimeout(resolve, 10));
  await pool.end();
  assert.deepEqual(schedulerErrors, []);
});
void test("rotation fences old invitations and cached replays", async () => {
  const r = await room(),
    old = raw(r.inviteUrl);
  const p = (await invites.preview(old)) as { id: string; participantCount: number };
  assert.equal(p.id, r.id);
  assert.equal(p.participantCount, 1);
  const joined = (await invites.join(a, "join-one", old)) as { id: string };
  assert.equal(joined.id, r.id);
  assert.deepEqual(await invites.join(a, "join-one", old), joined);
  const rotated = (await invites.rotate(host, r.id, "rotate-one")) as { inviteUrl: string };
  assert.notEqual(rotated.inviteUrl, r.inviteUrl);
  await assert.rejects(invites.preview(old));
  await assert.rejects(invites.join(a, "join-one", old));
  const newer = (await invites.rotate(host, r.id, "rotate-two")) as { inviteUrl: string };
  await assert.rejects(invites.rotate(host, r.id, "rotate-one"));
  assert.equal(((await invites.preview(raw(newer.inviteUrl))) as { id: string }).id, r.id);
  await close(r.id);
});
void test("concurrent account joins claim only one available seat", async () => {
  const r = await room(),
    token = raw(r.inviteUrl);
  const joins = await Promise.allSettled([
    invites.join(a, "seat-a", token),
    invites.join(b, "seat-b", token),
  ]);
  assert.equal(joins.filter((x) => x.status === "fulfilled").length, 1);
  const winner = joins[0].status === "fulfilled" ? a : b,
    key = winner === a ? "seat-a" : "seat-b";
  assert.equal(((await lifecycle.current(winner)) as { id: string }).id, r.id);
  await lifecycle.mutate(host, r.id, "host-ready", "ready", true);
  await lifecycle.mutate(winner, r.id, "winner-ready", "ready", true);
  assert.equal(((await invites.join(winner, key, token)) as { id: string }).id, r.id);
  await lifecycle.mutate(host, r.id, "finish-concurrent", "forfeit", null);
});
void test("guest credentials are scoped, idempotent, revocable and bounded", async () => {
  const r = await room(guestSettings),
    token = raw(r.inviteUrl),
    credential = newGuestToken();
  const [x, y] = (await Promise.all([
    invites.joinGuest(token, credential, "  Guest  "),
    invites.joinGuest(token, credential, "Guest"),
  ])) as [
    { participants: { userId: string; guest: boolean }[] },
    { participants: { userId: string; guest: boolean }[] },
  ];
  const guest = x.participants.find((p) => p.guest);
  assert.ok(guest);
  assert.equal(y.participants.find((p) => p.guest)?.userId, guest.userId);
  assert.equal(
    (await pool.query("SELECT guest_joins FROM matches WHERE id=$1", [r.id])).rows[0].guest_joins,
    1,
  );
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'inv-a','matches.host_guests','manual','guest-scope','fixture','test')",
    [crypto.randomUUID()],
  );
  const other = (await lifecycle.create(a, "other-room", guestSettings)) as {
    id: string;
    inviteUrl: string;
  };
  await assert.rejects(invites.joinGuest(raw(other.inviteUrl), credential, "Guest"));
  await lifecycle.mutate(a, other.id, "other-close", "leave", null);
  await invites.removeGuest(host, r.id, guest.userId, "remove-guest");
  await assert.rejects(invites.joinGuest(token, credential, "Guest"));
  const fresh = newGuestToken();
  await pool.query("UPDATE matches SET guest_joins=32 WHERE id=$1", [r.id]);
  await assert.rejects(
    invites.joinGuest(token, fresh, "Guest"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "forbidden",
  );
  await close(r.id);
});
void test("host disable and grant revocation close invitation admission", async () => {
  const r = await room(guestSettings),
    token = raw(r.inviteUrl);
  await pool.query("UPDATE users SET disabled=true WHERE id='inv-host'");
  await assert.rejects(invites.preview(token));
  await assert.rejects(invites.join(a, "disabled-host", token));
  await pool.query("UPDATE users SET disabled=false WHERE id='inv-host'");
  await pool.query(
    "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='inv-host' AND feature='matches.host_guests'",
  );
  await assert.rejects(
    invites.joinGuest(token, newGuestToken(), "Guest"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "entitlement_required",
  );
  await pool.query(
    "UPDATE entitlement_grants SET revoked_at=NULL WHERE user_id='inv-host' AND feature='matches.host_guests'",
  );
  await close(r.id);
});
void test("join versus free-for-all start preserves seat and workspace invariants", async () => {
  const r = await room(normalizeSettings({ difficulty: "easy", mode: "free-for-all" })),
    token = raw(r.inviteUrl);
  await invites.join(a, "race-first", token);
  await Promise.all([
    lifecycle.mutate(host, r.id, "race-h", "ready", true),
    lifecycle.mutate(a, r.id, "race-a", "ready", true),
  ]);
  const [joined, started] = await Promise.allSettled([
    invites.join(b, "race-second", token),
    lifecycle.mutate(host, r.id, "race-start", "start", null),
  ]);
  const row = (
    await pool.query(
      "SELECT state,(SELECT count(*)::int FROM match_participants WHERE match_id=matches.id) AS people,(SELECT count(*)::int FROM workspaces WHERE match_id=matches.id) AS workspaces FROM matches WHERE id=$1",
      [r.id],
    )
  ).rows[0];
  if (started.status === "fulfilled") {
    assert.equal(joined.status, "rejected");
    assert.equal(row.state, "active");
    assert.equal(row.people, 2);
    assert.equal(row.workspaces, 2);
    await lifecycle.mutate(host, r.id, "race-end", "forfeit", null);
  } else {
    assert.equal(joined.status, "fulfilled");
    assert.equal(row.people, 3);
    assert.equal(row.workspaces, 0);
    await close(r.id);
  }
});

void test("workspace language selection preserves per-language workspaces and membership", async () => {
  const r = await room(normalizeSettings({ selectedProblemVersionId: version }));
  await invites.join(a, "language-join", raw(r.inviteUrl));
  await lifecycle.mutate(host, r.id, "language-host-ready", "ready", true);
  await lifecycle.mutate(a, r.id, "language-a-ready", "ready", true);
  const before = (
    await pool.query(
      "SELECT workspace_id::text AS id FROM match_participants WHERE match_id=$1 AND owner_id=$2",
      [r.id, a.userId],
    )
  ).rows[0].id;
  const java = (await language.switchLanguage(a, r.id, "language-java", "java")) as {
    id: string;
    language: string;
  };
  assert.equal(java.language, "java");
  assert.deepEqual(await language.switchLanguage(a, r.id, "language-java", "java"), java);
  const python = (await language.switchLanguage(a, r.id, "language-python", "python")) as {
    id: string;
  };
  assert.equal(python.id, before);
  const submission = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,$4,'run','','fixture','queued','[]')",
    [submission, a.userId, python.id, r.id],
  );
  await assert.rejects(
    language.switchLanguage(a, r.id, "language-busy", "java"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "user_busy",
  );
  await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
  await assert.rejects(language.switchLanguage(a, r.id, "language-invalid", "unknown"));
  await assert.rejects(language.switchLanguage(b, r.id, "language-outsider", "java"));
  await lifecycle.mutate(host, r.id, "language-finish", "forfeit", null);
});

void test("Node HTTP applies credential precedence, origin and trusted-peer budget", async () => {
  const r = await room(guestSettings),
    token = raw(r.inviteUrl),
    credential = newGuestToken();
  const app = createApp({
    allowedOrigins: ["https://example.test"],
    requestId: () => "node-invite",
  }).route(
    "/",
    matchInvitationRoutes({
      invitations: invites,
      language,
      allowedOrigins: ["https://example.test"],
      admissionEnabled: true,
      trustedPeer: () => "127.0.0.1",
      budget: { allow: (peer) => run((scope) => publicGuestBudget(scope).allow(peer)) },
      identify: async (request) => {
        if (request.headers.has("authorization")) throw new IdentityError("unauthorized");
        return undefined;
      },
    }),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener unavailable");
  const url = `http://127.0.0.1:${address.port}/v1/match-invites/${token}/guest`;
  try {
    const send = (extra: Record<string, string>) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
          cookie: `quorem_guest=${credential}`,
          "x-forwarded-for": "203.0.113.5",
          ...extra,
        },
        body: '{"name":"Guest"}',
      });
    assert.equal((await send({ authorization: "Bearer invalid" })).status, 401);
    assert.equal((await send({ origin: "https://evil.test" })).status, 403);
    assert.equal(
      (await send({ cookie: `quorem_guest=${credential}; quorem_guest=${credential}` })).status,
      401,
    );
    assert.equal((await send({})).status, 200);
    const peerKeys = (
      await pool.query("SELECT key FROM guest_request_buckets WHERE key LIKE 'peer:%'")
    ).rows;
    assert.equal(peerKeys.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await close(r.id);
  }
});

void test("candidate selection admits only the sealed current host-owned problem", async () => {
  const settings = normalizeSettings({ selectedProblemVersionId: version });
  const choose = (owner: string) =>
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        selectMatchCandidate(tx, owner, settings),
      ),
    );
  assert.equal((await choose(host.userId)).id, version);
  await assert.rejects(choose(a.userId));
  await pool.query("UPDATE problems SET current_version_id=NULL WHERE id=$1", [problem]);
  try {
    await assert.rejects(choose(host.userId));
  } finally {
    await pool.query("UPDATE problems SET current_version_id=$2 WHERE id=$1", [problem, version]);
  }
});

void test("an invite expiring while blocked on the match lock cannot claim a seat", async () => {
  const r = await room();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE matches SET expires_at=clock_timestamp()+interval '120 milliseconds' WHERE id=$1",
      [r.id],
    );
    const attempt = invites.join(a, "expiry-race", raw(r.inviteUrl));
    await new Promise((resolve) => setTimeout(resolve, 220));
    await client.query("COMMIT");
    await assert.rejects(attempt);
    assert.equal(
      (
        await pool.query("SELECT count(*)::int AS n FROM match_participants WHERE match_id=$1", [
          r.id,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    client.release();
  }
  await lifecycle.read(host, r.id);
});
