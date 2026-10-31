/** @file integration.ts @description Disposable PostgreSQL interview lifecycle. @module interviews */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { sql } from "drizzle-orm";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { operationFingerprint } from "./operations.ts";
import { interviewLifecycle } from "./repository.ts";
const url = process.env.QUOREM_INTERVIEW_TEST_DATABASE_URL;
if (
  !url ||
  ![
    "55462:/quorem_hono_interview_test",
    "55465:/quorem_hono_result_stream_test",
    "55489:/quorem_hono_stream_lifecycle_test",
  ].includes(`${new URL(url).port}:${new URL(url).pathname}`) ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  throw new Error("Disposable interview database required");
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
  withNodeConnection(pool, { lifetimeMs: 8000 }, f);
const actor = (id: string): LocalPrincipal => ({
  kind: "local",
  userId: id,
  displayName: id,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
const host = actor("interview-host"),
  member = actor("interview-member"),
  other = actor("interview-other");
const repo = interviewLifecycle(run, {
  // SQL-backed fixture collaborators isolate lifecycle behavior until 23a is composed.
  question: async (_tx, _actor, c) => ({
    safe: JSON.stringify({
      problem: { title: "Public" },
      hiddenCases: [{ expected: "PRIVATE FIXTURE" }],
    }),
    lossless: null,
    source: "PRIVATE SOURCE",
    language: "python",
    fingerprint: await operationFingerprint("create", c.title),
  }),
  snapshot: async (who, id) => {
    const value = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        const row = (
          await tx.execute<{
            id: string;
            title: string;
            state: string;
            role: string;
            version: string;
            invite: string;
            interviewer: string;
          }>(
            sql`SELECT i.id::text,i.title,i.state,m.role,i.version::text,i.invite_token AS invite,i.interviewer_invite_token AS interviewer FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL WHERE i.id=${id}::uuid AND i.deleted_at IS NULL`,
          )
        ).rows[0];
        if (!row) throw new Error("Missing member");
        return JSON.stringify({
          id: row.id,
          title: row.title,
          state: row.state,
          role: row.role,
          version: row.version,
          ...(row.role === "interviewer"
            ? { invites: { interviewee: row.invite, interviewer: row.interviewer } }
            : {}),
        });
      }),
    );
    return new Response(value).body!;
  },
});
let id = "",
  invite = "",
  interviewer = "";
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name) VALUES('interview-host','Host'),('interview-member','Member'),('interview-other','Other')",
  );
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'interview-host','interviews.host','manual','test','test','test')",
    [crypto.randomUUID()],
  );
});
after(async () => {
  await pool.end();
});
void test("creation serializes host capacity and preserves retry identity", async () => {
  const input = { title: "Room", question: { problemVersionId: "fixture", language: "python" } };
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, (_, i) => repo.create(host, `create-${i}`, input)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const index = results.findIndex((r) => r.status === "fulfilled"),
    ack = JSON.parse((results[index] as PromiseFulfilledResult<string>).value);
  id = ack.id;
  const created = JSON.parse(await new Response(await repo.read(host, id)).text());
  invite = created.invites.interviewee;
  interviewer = created.invites.interviewer;
  assert.equal(JSON.parse(await repo.create(host, `create-${index}`, input)).id, id);
  const list = await repo.list(host);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(list[0])).sort(), [
    "hostId",
    "id",
    "memberCount",
    "problemTitle",
    "role",
    "state",
    "title",
  ]);
  assert.doesNotMatch(list[0], /PRIVATE|source|invite/i);
  await assert.rejects(repo.create(member, "missing-capability", input));
});
void test("invite projection is public-safe and joins honor role, locking and removal", async () => {
  const preview = await repo.preview(invite);
  assert.deepEqual(Object.keys(preview).sort(), ["role", "sessionId", "state", "title"]);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE|source|token/);
  assert.equal(
    (await repo.join(member, invite, undefined, ""),
    JSON.parse(await new Response(await repo.read(member, id)).text()).role),
    "interviewee",
  );
  assert.equal(
    (await repo.join(member, interviewer, undefined, ""),
    JSON.parse(await new Response(await repo.read(member, id)).text()).role),
    "interviewer",
  );
  assert.equal(
    (await repo.join(member, invite, undefined, ""),
    JSON.parse(await new Response(await repo.read(member, id)).text()).role),
    "interviewer",
  );
  await assert.rejects(repo.setMember(host, id, "bad-role", host.userId, "interviewee"));
  await repo.setMember(host, id, "demote", member.userId, "interviewee");
  await repo.removeMember(host, id, "remove", member.userId);
  await assert.rejects(repo.read(member, id));
  await assert.rejects(repo.join(member, invite, undefined, ""));
});
void test("guest reuse, revocation and stale cookies preserve scope", async () => {
  const joined = await repo.join(undefined, invite, undefined, "Guest");
  assert.ok(joined.credential);
  const guestId = joined.id;
  assert.equal((await repo.join(undefined, invite, joined.credential, "Guest")).id, guestId);
  const owner = (
    await pool.query("SELECT owner_id FROM interview_guest_sessions WHERE session_id=$1", [id])
  ).rows[0].owner_id as string;
  await repo.removeMember(host, id, "remove-guest", owner);
  await assert.rejects(repo.join(undefined, invite, joined.credential, "Guest"));
});
void test("grant revocation freezes joins but still permits close/delete and preserves rows", async () => {
  await pool.query(
    "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='interview-host'",
  );
  await assert.rejects(repo.preview(invite));
  await assert.rejects(repo.join(other, invite, undefined, ""));
  assert.equal(
    (await repo.close(host, id, "close"),
    JSON.parse(await new Response(await repo.read(host, id)).text()).state),
    "closed",
  );
  assert.equal(
    (await repo.close(host, id, "close"),
    JSON.parse(await new Response(await repo.read(host, id)).text()).state),
    "closed",
  );
  await repo.delete(host, id);
  await repo.delete(host, id);
  assert.equal(
    (await pool.query("SELECT id FROM interviews WHERE id=$1 AND deleted_at IS NOT NULL", [id]))
      .rowCount,
    1,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM interview_members WHERE session_id=$1", [id]))
      .rows[0].n,
    3,
  );
  assert.equal((await repo.list(host)).length, 0);
});

void test("admission locking serializes close and concurrent joins", async () => {
  await pool.query("UPDATE entitlement_grants SET revoked_at=NULL WHERE user_id='interview-host'");
  const created = JSON.parse(
    await repo.create(host, "race-create", { title: "Race", question: {} }),
  );
  const room = created.id as string,
    token = JSON.parse(await new Response(await repo.read(host, room)).text()).invites
      .interviewee as string;
  await repo.setAdmission(host, room, "lock", true);
  await assert.rejects(
    repo.join(other, token, undefined, ""),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "admission_locked",
  );
  await repo.setAdmission(host, room, "unlock", false);
  const [closed, joined] = await Promise.allSettled([
    repo.close(host, room, "race-close"),
    repo.join(other, token, undefined, ""),
  ]);
  assert.equal(closed.status, "fulfilled");
  if (joined.status === "rejected")
    assert.equal((joined.reason as { code: string }).code, "invalid_transition");
  assert.equal(
    (await pool.query("SELECT state FROM interviews WHERE id=$1", [room])).rows[0].state,
    "closed",
  );
  await assert.rejects(repo.join(other, token, undefined, ""));
});
void test("public snapshots read only unlocked examples and authorized revealed case bytes", async () => {
  const { storageProjection } = await import("../../problems/storage.ts");
  const { backfillInterviewPublicExamples } = await import("../question/public-examples.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const id = crypto.randomUUID(),
    epoch = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    document = crypto.randomUUID();
  const raw = `{"problem":{"id":"${problem}","slug":"test","version":"1","title":"Public","difficulty":"easy","tags":[],"statementMarkdown":"Visible","signature":{"className":"Solution","methodName":"solve","parameters":[],"returnType":"int"},"constraints":[],"limits":{},"languages":[{"language":"python","starterSource":"pass","runtimeRevision":"v1","harnessRevision":"h1","referenceSource":"SECRET REFERENCE"}],"starterSource":"pass","runtimeRevision":"v1","odyssey":{"levels":[{"title":"One","statementMarkdown":"First","methods":[{"className":"Solution","methodName":"solve","parameters":[],"returnType":"int"}],"examples":[{"args":[9007199254740993],"expected":"public\\u0000"}]},{"title":"FUTURE","statementMarkdown":"Hidden stage","methods":[],"examples":[{"args":[],"expected":"later"}]}]}},"odysseyHiddenCases":[[{"args":[1],"expected":"PRIVATE-ONE\\u0000"}],[{"args":[2],"expected":"PRIVATE-TWO"}]],"hiddenCases":[]}`;
  const stored = storageProjection(raw),
    candidate = "interview-member";
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,'interview-host','Projection',$2::jsonb,'python','editor',$3,$4,$5,$5,$6,$6,$7)",
    [id, stored.safe, document, epoch, crypto.randomUUID(), crypto.randomUUID(), stored.lossless],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,'interview-host','interviewer'),($1,$2,'interviewee')",
    [id, candidate],
  );
  await assert.rejects(interviewSnapshot(member, id));
  assert.equal(
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        backfillInterviewPublicExamples(tx, id, crypto.randomUUID()),
      ),
    ),
    false,
  );
  assert.equal(
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        backfillInterviewPublicExamples(tx, id, epoch),
      ),
    ),
    true,
  );
  const read = async (who: LocalPrincipal) => new Response(await interviewSnapshot(who, id)).text();
  const candidateValue = await read(member);
  assert.match(candidateValue, /9007199254740993/);
  assert.match(candidateValue, /public\\u0000/);
  assert.doesNotMatch(candidateValue, /FUTURE|PRIVATE-ONE|PRIVATE-TWO|SECRET REFERENCE|invitePath/);
  const staff = await read(host);
  assert.match(staff, /PRIVATE-ONE\\u0000/);
  assert.match(staff, /PRIVATE-TWO/);
  assert.doesNotMatch(staff, /SECRET REFERENCE/);
  await pool.query(
    "INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES($1,$2,'level:1:case:0')",
    [id, epoch],
  );
  const revealed = await read(member);
  assert.match(revealed, /PRIVATE-ONE\\u0000/);
  assert.doesNotMatch(revealed, /PRIVATE-TWO/);
  await pool.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='quorem_interview_public_test') THEN CREATE ROLE quorem_interview_public_test NOLOGIN; END IF; END $$`,
  );
  await pool.query(`GRANT USAGE ON SCHEMA public TO quorem_interview_public_test`);
  await pool.query(
    `GRANT SELECT(id,host_id,state,question_epoch,document_epoch,admission_locked,deleted_at,version,title,monitoring,source,document_version,language,invite_token,interviewer_invite_token) ON interviews TO quorem_interview_public_test`,
  );
  await pool.query(`GRANT UPDATE(id) ON interviews TO quorem_interview_public_test`);
  await pool.query(`GRANT UPDATE(id) ON users TO quorem_interview_public_test`);
  await pool.query(`GRANT UPDATE(session_id) ON interview_members TO quorem_interview_public_test`);
  await pool.query(
    `GRANT SELECT ON interview_question_public,interview_members,users,interview_public_examples,interview_question_private_cases,interview_case_visibility,interview_execution_public,execution_jobs,submissions,odyssey_progress,problem_solutions TO quorem_interview_public_test`,
  );
  await assert.rejects(
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE quorem_interview_public_test`);
        await tx.execute(sql`SELECT question,lossless_question FROM interviews LIMIT 1`);
      }),
    ),
  );
  const restrictedRun = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    run((scope) =>
      f({
        ...scope,
        transaction: (options, action) =>
          scope.transaction(options, async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE quorem_interview_public_test`);
            return action(tx);
          }),
      }),
    );
  const restricted = await new Response(
    await interviewSnapshotStream(restrictedRun)(member, id),
  ).text();
  assert.match(restricted, /PRIVATE-ONE\\u0000/);
  assert.doesNotMatch(restricted, /PRIVATE-TWO|SECRET REFERENCE/);
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT set_config('quorem.lossless_case_write','v1',true)");
    await writer.query(
      "UPDATE interviews SET question=jsonb_set(question,'{hints}', '{\"topics\":false}'::jsonb) WHERE id=$1",
      [id],
    );
    await writer.query("COMMIT");
  } finally {
    writer.release();
  }
  assert.equal(JSON.parse(await read(member)).hints.topics, false);
  await pool.query(
    "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,2)",
    [epoch, problem],
  );
  assert.match(await read(member), /FUTURE/);
  await pool.query(
    "DELETE FROM interview_public_examples WHERE session_id=$1 AND question_epoch=$2 AND level=2",
    [id, epoch],
  );
  await assert.rejects(read(member));
});
void test("backfill CAS rejects a changed question epoch after waiting for the lock", async () => {
  const { backfillInterviewPublicExamples } = await import("../question/public-examples.ts");
  const row = (
    await pool.query(
      "SELECT id::text,question_epoch::text FROM interviews WHERE title='Projection'",
    )
  ).rows[0] as { id: string; question_epoch: string };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM interviews WHERE id=$1 FOR UPDATE", [row.id]);
    const pending = run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        backfillInterviewPublicExamples(tx, row.id, row.question_epoch),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.query("UPDATE interviews SET question_epoch=$2 WHERE id=$1", [
      row.id,
      crypto.randomUUID(),
    ]);
    await client.query("COMMIT");
    assert.equal(await pending, false);
  } finally {
    client.release();
  }
});
void test("published question creation composes canonical authoring, storage and snapshot owners", async () => {
  const { readFileSync } = await import("node:fs");
  const { questionAuthoring } = await import("../../problems/authoring/repository.ts");
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const runtime = (language: string) =>
    (
      ({
        python: { revision: "python-3.12-v1", harness: "quorem-harness-v2" },
        java: { revision: "java-21.0.9-v1", harness: "quorem-java-v1" },
        typescript: {
          revision: "typescript-5.9.3-node-22.21.1-v1",
          harness: "quorem-typescript-v1",
        },
        ocaml: { revision: "ocaml-4.13.1-v1", harness: "quorem-ocaml-v1" },
        postgresql: { revision: "postgresql-17.6-v1", harness: "quorem-postgresql-v2" },
      }) as Record<string, { revision: string; harness: string }>
    )[language];
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'interview-host','questions.custom','manual','author','test','test')",
    [crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES('interview-host','interview_concurrency',10,'test','test')",
  );
  const author = questionAuthoring(run, runtime),
    identity = { userId: host.userId, admin: false },
    content = JSON.parse(readFileSync(resolve("../../fixtures/problems/run-widths.json"), "utf8"));
  content.problem.slug = `interview-test-${crypto.randomUUID()}`;
  const draft = JSON.parse(await author.create(identity, JSON.stringify(content), undefined)),
    published = JSON.parse(await author.publish(identity, draft.id, draft.revision, "private"));
  const actual = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshot,
  });
  const command = {
    title: "Published",
    question: { problemVersionId: published.publishedVersionId, language: "python" },
  };
  const ack = JSON.parse(await actual.create(host, "published-create", command));
  const created = JSON.parse(await new Response(await actual.read(host, ack.id)).text());
  assert.equal(created.title, "Published");
  assert.equal(created.role, "interviewer");
  assert.ok(created.question.problem.signature);
  assert.ok(created.question.privateCaseDetails.length > 0);
  assert.equal(JSON.parse(await actual.create(host, "published-create", command)).id, created.id);
  const preview = await actual.preview(
    created.invites.interviewee.replace("/interview-invite/", ""),
  );
  assert.doesNotMatch(JSON.stringify(preview), /source|expected|hidden/i);
});
void test("custom question creates and replays a canonical private library version", async () => {
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const actual = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshot,
  });
  const command = {
    title: "Custom",
    question: {
      language: "python",
      custom: {
        title: "Echo",
        statementMarkdown: "Return the input.",
        signature: {
          className: "Solution",
          methodName: "echo",
          parameters: [{ name: "value", type: "str" }],
          returnType: "str",
        },
        publicCases: [{ args: ["a"], expected: "a" }],
        privateCases: [{ args: ["b"], expected: "b" }],
      },
    },
  };
  const ack = JSON.parse(await actual.create(host, "custom-create", command));
  const created = JSON.parse(await new Response(await actual.read(host, ack.id)).text());
  assert.equal(created.title, "Custom");
  assert.equal(created.question.problem.slug, "interview-private");
  assert.equal(created.question.privateCaseDetails[0].case.expected, "b");
  assert.equal(
    (
      await pool.query(
        "SELECT fingerprint FROM interview_operations WHERE owner_id=$1 AND key='custom-create'",
        [host.userId],
      )
    ).rows[0].fingerprint,
    "84317f9d98261ad50c71086e3cdb0afb593b41a53587e84962620987a9ae9324",
  );
  const retried = JSON.parse(await actual.create(host, "custom-create", command));
  assert.equal(retried.id, created.id);
  const library = (
    await pool.query(
      "SELECT p.owner_id,v.sealed FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=$1",
      [created.question.problem.id],
    )
  ).rows[0];
  assert.equal(library.owner_id, host.userId);
  assert.equal(library.sealed, true);
});
void test("real HTTP guest join shares origin, budget, cookie and bearer precedence", async () => {
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const { interviewLifecycleRoutes } =
    await import("../../../../modules/interviews/lifecycle/routes.ts");
  const { createApp } = await import("../../../../app.ts");
  const { publicGuestBudget } = await import("../../identity/guest.ts");
  const { IdentityError } = await import("../../../../modules/identity/model.ts");
  const actual = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshot,
  });
  const created = JSON.parse(
    (await pool.query("SELECT id,invite_token FROM interviews WHERE title='Published'")).rows.length
      ? await new Response(
          await actual.read(
            host,
            (await pool.query("SELECT id::text FROM interviews WHERE title='Published'")).rows[0]
              .id,
          ),
        ).text()
      : "{}",
  );
  const token = created.invites.interviewee.replace("/interview-invite/", "");
  const origin = "https://quorem.test";
  const app = createApp({ allowedOrigins: [origin], requestId: () => "interview-http" }).route(
    "/",
    interviewLifecycleRoutes({
      lifecycle: actual,
      allowedOrigins: [origin],
      trustedPeer: () => "127.0.0.1",
      budget: { allow: (peer) => run((scope) => publicGuestBudget(scope).allow(peer)) },
      identify: async (request) => {
        if (request.headers.has("authorization")) throw new IdentityError("unauthorized");
        return undefined;
      },
    }),
  );
  const preview = await app.request(`/v1/interview-invites/${token}`);
  assert.equal(preview.status, 200);
  assert.doesNotMatch(await preview.text(), /PRIVATE|source|expected/i);
  const join = await app.request(`/v1/interview-invites/${token}/join`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"name":"Guest"}',
  });
  assert.equal(join.status, 200);
  assert.equal(join.headers.get("cache-control"), "no-store");
  assert.equal(join.headers.get("referrer-policy"), "no-referrer");
  const cookie = join.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /quorem_interview_guest=.*HttpOnly.*SameSite=Strict.*Secure/);
  const raw = await join.text();
  assert.doesNotMatch(raw, /privateCaseDetails|PRIVATE|referenceSource/);
  const requestCookie = cookie.split(";")[0];
  const resumed = await app.request(`/v1/interview-invites/${token}/join`, {
    method: "POST",
    headers: { origin, cookie: requestCookie, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(resumed.status, 200);
  const bad = await app.request(`/v1/interview-invites/${token}/join`, {
    method: "POST",
    headers: { origin, cookie: requestCookie, authorization: "Bearer invalid" },
    body: "{}",
  });
  assert.equal(bad.status, 401);
  const duplicate = await app.request(`/v1/interview-invites/${token}/join`, {
    method: "POST",
    headers: { origin, cookie: `${requestCookie}; ${requestCookie}` },
    body: "{}",
  });
  assert.equal(duplicate.status, 401);
  assert.equal(
    (await app.request(`/v1/interview-invites/${token}/join`, { method: "POST", body: "{}" }))
      .status,
    403,
  );
});
void test("immutable fixture backfill gates complete staged public sidecars", async () => {
  const { storageProjection } = await import("../../problems/storage.ts");
  const { backfillSnapshotPublicExamples, readSnapshotPublicExamples } =
    await import("../question/public-examples.ts");
  const session = (await pool.query("SELECT id::text FROM interviews WHERE title='Projection'"))
    .rows[0].id as string;
  const raw =
    '{"problem":{"examples":[],"odyssey":{"levels":[{"examples":[{"args":[9007199254740993],"expected":"x\\u0000"}]},{"examples":[{"args":[],"expected":"future"}]}]}},"odysseyHiddenCases":[[],[]],"hiddenCases":[]}';
  const safe = storageProjection(raw);
  assert.ok(safe.lossless);
  const row = (
    await pool.query(
      "WITH d AS (SELECT jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) AS value) INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT $1,sha256(convert_to(value::text,'UTF8')),value,$3 FROM d RETURNING id",
      [session, safe.safe, safe.lossless],
    )
  ).rows[0];
  const fixtureId = row.id as Uint8Array;
  const read = () =>
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        readSnapshotPublicExamples(tx, session, fixtureId, 2, 1),
      ),
    );
  await assert.rejects(read());
  assert.equal(
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        backfillSnapshotPublicExamples(tx, session, fixtureId),
      ),
    ),
    true,
  );
  const value = JSON.stringify(await read());
  assert.match(value, /9007199254740993/);
  assert.doesNotMatch(value, /future/);
  await pool.query(
    "DELETE FROM interview_snapshot_public_examples WHERE session_id=$1 AND fixture_id=$2 AND level=2",
    [session, fixtureId],
  );
  await assert.rejects(read());
});
void test("custom Odyssey construction persists each stage and limits candidate stage output", async () => {
  const { readFileSync } = await import("node:fs");
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const content = JSON.parse(
    readFileSync(resolve("../../fixtures/odyssey/balance-ledger.json"), "utf8"),
  );
  const command = {
    title: "Custom staged",
    question: {
      language: "python",
      custom: {
        title: content.problem.title,
        statementMarkdown: content.problem.statementMarkdown,
        signature: content.problem.signature,
        odyssey: content.problem.odyssey,
        odysseyHiddenCases: content.odysseyHiddenCases,
      },
    },
  };
  const actual = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshot,
  });
  const ack = JSON.parse(await actual.create(host, "custom-staged", command));
  const created = JSON.parse(await new Response(await actual.read(host, ack.id)).text());
  assert.equal(created.question.progress.totalLevels, content.problem.odyssey.levels.length);
  assert.equal(created.question.progress.levels.length, 1);
  assert.ok(created.question.privateCaseDetails.length > 0);
});
void test("HTTP custom creation preserves lossless numeric test cases", async () => {
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewSnapshotStream } = await import("../question/stream.ts");
  const interviewSnapshot = interviewSnapshotStream(run);
  const { interviewLifecycleRoutes } =
    await import("../../../../modules/interviews/lifecycle/routes.ts");
  const { createApp } = await import("../../../../app.ts");
  const { publicGuestBudget } = await import("../../identity/guest.ts");
  const app = createApp({ allowedOrigins: [], requestId: () => "numeric" }).route(
    "/",
    interviewLifecycleRoutes({
      lifecycle: interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: interviewSnapshot,
      }),
      identify: async () => host,
      allowedOrigins: [],
      trustedPeer: () => "127.0.0.1",
      budget: { allow: (peer) => run((scope) => publicGuestBudget(scope).allow(peer)) },
    }),
  );
  const payload =
    '{"title":"Number","question":{"language":"python","custom":{"title":"Number","statementMarkdown":"Return number.","signature":{"className":"Solution","methodName":"echo","parameters":[{"name":"value","type":"float"}],"returnType":"float"},"publicCases":[{"args":[9007199254740993],"expected":9007199254740993}],"privateCases":[{"args":[1],"expected":1}]}}}';
  const response = await app.request("/v1/interviews", {
    method: "POST",
    headers: { "Idempotency-Key": "numeric" },
    body: payload,
  });
  const text = await response.text();
  assert.equal(response.status, 201, text);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const ack = JSON.parse(text);
  assert.match(await (await app.request(`/v1/interviews/${ack.id}`)).text(), /9007199254740993/);
});
void test("privileged backfill runs in bounded batches", async () => {
  const { backfillInterviewBatch } = await import("../question/backfill.ts");
  const first = await backfillInterviewBatch(run, 1);
  assert.ok(first.attempted <= 1);
  assert.ok(first.completed <= first.attempted);
  assert.deepEqual(Object.keys(first).sort(), ["attempted", "completed"]);
  await assert.rejects(backfillInterviewBatch(run, 65));
});
void test("historical result reader fetches only revealed case and result bytes under restricted role", async () => {
  const { storageProjection } = await import("../../problems/storage.ts");
  const { backfillSnapshotPublicExamples } = await import("../question/public-examples.ts");
  const { backfillPrivateResultCases, savePrivateResultCase } =
    await import("../question/private-results.ts");
  const { submissionSnapshots } = await import("../../judging/results/repository.ts");
  const session = (
    await pool.query(
      "SELECT id::text,question_epoch::text FROM interviews WHERE title='Projection'",
    )
  ).rows[0] as { id: string; question_epoch: string };
  session.question_epoch = crypto.randomUUID();
  await pool.query("UPDATE interviews SET question_epoch=$2 WHERE id=$1", [
    session.id,
    session.question_epoch,
  ]);
  const submission = crypto.randomUUID(),
    document = crypto.randomUUID();
  const raw =
    '{"problem":{"examples":[]},"hiddenCases":[{"args":[9007199254740993],"expected":"PRIVATE-A\\u0000"},{"args":[2],"expected":"PRIVATE-B"}]}';
  const fixture = storageProjection(raw);
  const q = (
    await pool.query(
      "WITH d AS (SELECT jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) AS value) INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT $1,sha256(convert_to(value::text,'UTF8')),value,$3 FROM d RETURNING id",
      [session.id, fixture.safe, fixture.lossless],
    )
  ).rows[0].id as Uint8Array;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases,result) VALUES($1,\'interview-member\',$2,\'submit\',\'\',\'hash\',\'completed\',\'[]\',\'{"verdict":"wrong_answer","hiddenCases":[{"index":0,"status":"wrong_answer"},{"index":1,"status":"wrong_answer"}]}\')',
      [submission, session.id],
    );
    await client.query(
      'INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level,private_results,private_results_payload) VALUES($1,$2,1,$3,$4,$5,1,\'[{"index":0,"status":"wrong_answer"},{"index":1,"status":"wrong_answer"}]\',$6)',
      [
        submission,
        session.id,
        document,
        session.question_epoch,
        q,
        Buffer.from(
          '[{"index":0,"status":"wrong_answer","actual":"RESULT-A\\u0000","expected":9007199254740993},{"index":1,"status":"wrong_answer","actual":"RESULT-B","expected":"PRIVATE-B"}]',
        ),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const actualSnapshots = submissionSnapshots(run);
  const snapshots = {
    ...actualSnapshots,
    interview: async (...args: Parameters<typeof actualSnapshots.interview>) =>
      new Response(await actualSnapshots.interview(...args)).text(),
  };
  await assert.rejects(snapshots.interview(member, session.id, submission));
  const { backfillSubmissionResult } = await import("../../judging/results/backfill.ts");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      backfillSubmissionResult(tx, submission),
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      backfillSnapshotPublicExamples(tx, session.id, q),
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      backfillPrivateResultCases(tx, submission),
    ),
  );
  const guardedWrite = (raw: string) =>
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`SELECT set_config('quorem.result_backfill','v1',true)`);
        await savePrivateResultCase(tx, submission, 0, raw);
      }),
    );
  await guardedWrite(
    '{"index":0,"status":"wrong_answer","actual":"RESULT-A\\u0000","expected":9007199254740993}',
  );
  await assert.rejects(guardedWrite('{"index":0,"status":"accepted"}'), /Private result conflict/);
  await pool.query("UPDATE submissions SET state='running' WHERE id=$1", [submission]);
  assert.equal(
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        backfillPrivateResultCases(tx, submission),
      ),
    ),
    false,
  );
  await pool.query("UPDATE submissions SET state='completed' WHERE id=$1", [submission]);
  await pool.query(
    "INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES($1,$2,'hidden:0')",
    [session.id, session.question_epoch],
  );
  await pool.query(
    "GRANT SELECT ON submission_result_headers,submission_result_header_fields,submission_public_result_cases,interview_execution_public,interview_snapshot_public,interview_snapshot_public_examples,interview_private_result_cases TO quorem_interview_public_test",
  );
  const restrictedRun = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    run((scope) =>
      fn({
        transaction: (options, action) =>
          scope.transaction(options, async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE quorem_interview_public_test`);
            return action(tx);
          }),
      }),
    );
  await assert.rejects(
    restrictedRun((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`SELECT fixture,lossless_fixture FROM interview_question_snapshots LIMIT 1`,
        );
      }),
    ),
  );
  await assert.rejects(
    restrictedRun((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`SELECT private_results_payload FROM interview_execution LIMIT 1`);
      }),
    ),
  );
  const candidate = await new Response(
    await submissionSnapshots(restrictedRun).interview(member, session.id, submission),
  ).text();
  assert.match(candidate, /PRIVATE-A\\u0000/);
  assert.match(candidate, /RESULT-A\\u0000/);
  assert.match(candidate, /9007199254740993/);
  assert.doesNotMatch(candidate, /PRIVATE-B|RESULT-B/);
  const staff = await snapshots.interview(host, session.id, submission);
  assert.match(staff, /PRIVATE-B/);
  assert.match(staff, /RESULT-B/);
  await pool.query("UPDATE interviews SET question_epoch=$2 WHERE id=$1", [
    session.id,
    crypto.randomUUID(),
  ]);
  const stale = await snapshots.interview(member, session.id, submission);
  assert.doesNotMatch(stale, /PRIVATE-A|PRIVATE-B|RESULT-A|RESULT-B/);
  assert.match(await snapshots.interview(host, session.id, submission), /PRIVATE-B/);
});
