/** @file integration.ts @description Disposable PostgreSQL review authorization and retention. @module matches */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { languageRuntime } from "@quorem/execution";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { persistQuestionVersion } from "../../problems/publication.ts";
import { retainBatch } from "../../events/scheduling/retention.ts";
import { matchSnapshot } from "../lifecycle/repository.ts";
import { matchReviewRepository } from "./repository.ts";

const url = process.env.QUOREM_REVIEW_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable review database required");
assertRunnerFixture(url, ["/quorem_hono_review_test"]);
const pool = createNodePool({
  connectionString: url,
  max: 4,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: (e) => {
    throw e;
  },
});
const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, f);
const repo = matchReviewRepository(run);
const actor = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: userId,
  strongUntil: 0,
});
const ids = {
  problem: crypto.randomUUID(),
  version: crypto.randomUUID(),
  match: crypto.randomUUID(),
  next: crypto.randomUUID(),
  a: crypto.randomUUID(),
  b: crypto.randomUUID(),
  first: crypto.randomUUID(),
  last: crypto.randomUUID(),
};
before(async () => {
  await migrate(pool, "product", resolve("apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES ('review-a','A','account'),('review-b','B','account'),('review-c','C','account')",
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
      "utf8",
    ),
  );
  Object.assign(fixture.problem, {
    id: ids.version,
    slug: "review-fixture",
    version: "1",
    title: "Review",
    constraints: [],
  });
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO problems(id,slug) VALUES(${ids.problem}::uuid,'review-fixture')`,
      );
      await persistQuestionVersion(
        tx,
        JSON.stringify(fixture),
        ids.problem,
        ids.version,
        1,
        null,
        (language) => {
          const runtime = languageRuntime(language);
          return runtime ? { revision: runtime.revision, harness: runtime.harness } : undefined;
        },
      );
    }),
  );
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,problem_version_id,started_at,deadline,share_code_after_match) VALUES($1,'review-a','review-unique',now()+interval '1 hour',30,'active',ARRAY['easy'],$2,now()-interval '8 days',now(),true)",
    [ids.match, ids.version],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,'review-a',$3,'python','match',$4),($2,'review-b',$3,'java','match',$4)",
    [ids.a, ids.b, ids.version, ids.match],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat,workspace_id,forfeited) VALUES($1,'review-a',1,$2,true),($1,'review-b',2,$3,false)",
    [ids.match, ids.a, ids.b],
  );
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases,result,admitted_at) VALUES($1,'review-b',$3,$4,1,'submit','old','hash','completed','[]','{\"verdict\":\"wrong_answer\"}',now()-interval '8 days'),($2,'review-b',$3,$4,2,'submit','last','hash','completed','[]','{\"verdict\":\"accepted\"}',now()-interval '8 days')",
    [ids.first, ids.last, ids.b, ids.match],
  );
});
after(async () => {
  await pool.end();
});
void test("completed review is participant-only, latest-round and frozen-sharing bounded", async () => {
  await assert.rejects(repo.read(actor("review-a"), ids.match), { status: 404 });
  await pool.query(
    "UPDATE matches SET state='completed',completed_at=now(),outcome='{}' WHERE id=$1",
    [ids.match],
  );
  const pending = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases,admitted_at) VALUES($1,'review-a',$2,$3,3,'submit','pending','hash','queued','[]',now())",
    [pending, ids.a, ids.match],
  );
  await assert.rejects(repo.read(actor("review-a"), ids.match), { status: 404 });
  const snapshot = (await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      matchSnapshot(tx, ids.match, "review-a"),
    ),
  )) as { reviewPending: boolean };
  assert.equal(snapshot.reviewPending, true);
  await pool.query("UPDATE submissions SET state='failed' WHERE id=$1", [pending]);
  const ready = (await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      matchSnapshot(tx, ids.match, "review-a"),
    ),
  )) as { reviewPending: boolean };
  assert.equal(ready.reviewPending, false);
  await pool.query("DELETE FROM submissions WHERE id=$1", [pending]);
  await assert.rejects(repo.read(actor("review-c"), ids.match), { status: 404 });
  let data = JSON.parse(await repo.read(actor("review-a"), ids.match));
  assert.equal(data.participants[0].workspace.id, ids.a);
  assert.equal(data.participants[0].submission, null);
  assert.equal(data.participants[1].submission.source, "last");
  assert.equal(data.participants[1].submission.verdict, "accepted");
  assert.equal(data.participants[1].workspace, null);
  await pool.query("UPDATE matches SET share_code_after_match=false WHERE id=$1", [ids.match]);
  data = JSON.parse(await repo.read(actor("review-a"), ids.match));
  assert.equal(data.participants.length, 1);
  assert.equal(
    JSON.parse(await repo.read(actor("review-b"), ids.match)).participants[0].submission.source,
    "last",
  );
  await pool.query("UPDATE matches SET completed_at=now()-interval '24 hours' WHERE id=$1", [
    ids.match,
  ]);
  await assert.rejects(repo.read(actor("review-a"), ids.match), { status: 404 });
  await pool.query(
    "UPDATE matches SET completed_at=now(),share_code_after_match=true WHERE id=$1",
    [ids.match],
  );
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES($1,'review-a','review-next',now()+interval '1 hour',30,'active',ARRAY['easy'],now(),now()+interval '30 minutes',$2)",
    [ids.next, ids.version],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'review-a',1)",
    [ids.next],
  );
  await assert.rejects(repo.read(actor("review-a"), ids.match), { status: 404 });
  assert.equal(
    JSON.parse(await repo.read(actor("review-b"), ids.match)).participants[1].submission.source,
    "last",
  );
});
void test("retention holds latest source during delayed settlement and releases it after expiry", async () => {
  await pool.query("UPDATE users SET kind='guest' WHERE id='review-b'");
  await retainBatch(run);
  assert.equal(
    (await pool.query("SELECT source FROM submissions WHERE id=$1", [ids.last])).rows[0].source,
    "last",
  );
  assert.equal(
    (await pool.query("SELECT source FROM submissions WHERE id=$1", [ids.first])).rows[0].source,
    "",
  );
  await pool.query("UPDATE matches SET completed_at=now()-interval '25 hours' WHERE id=$1", [
    ids.match,
  ]);
  await retainBatch(run);
  assert.equal(
    (await pool.query("SELECT source FROM submissions WHERE id=$1", [ids.last])).rows[0].source,
    "",
  );
});

void test("party guest is restricted to participated rounds and live credentials", async () => {
  const { guestRepository, guestMayReadMatch } = await import("../../identity/guest.ts");
  const { workspaceRepository } = await import("../../workspace/repository.ts");
  const { problemQueries } = await import("../../problems/queries/repository.ts");
  const party = crypto.randomUUID(),
    otherParty = crypto.randomUUID(),
    first = crypto.randomUUID(),
    second = crypto.randomUUID(),
    outsider = crypto.randomUUID(),
    own = crypto.randomUUID(),
    otherWorkspace = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES ('review-guest','Guest','guest'),('review-new','New','guest')",
  );
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,'review-a','matches.host_guests','manual','party-review','fixture','test')",
    [crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO parties(id,host_owner_id,invite_hash,settings) VALUES($1,'review-a','party-review','{}'),($2,'review-a','party-review-other','{}')",
    [party, otherParty],
  );
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,party_id,expires_at,last_seen_at) VALUES ('review-guest-token','review-guest',$1,now()+interval '1 day',now()-interval '3 hours'),('review-new-token','review-new',$1,now()+interval '1 day',now())",
    [party],
  );
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,problem_version_id,started_at,deadline,party_id,share_code_after_match,completed_at,outcome) VALUES($1,'review-a','guest-round-one',now()+interval '1 hour',30,'completed',ARRAY['easy'],$4,now()-interval '1 hour',now(),$5,true,now(),'{}'),($2,'review-a','guest-round-two',now()+interval '1 hour',30,'active',ARRAY['easy'],$4,now(),now()+interval '30 minutes',$5,true,NULL,NULL),($3,'review-a','guest-other-party',now()+interval '1 hour',30,'active',ARRAY['easy'],$4,now()-interval '1 minute',now()+interval '30 minutes',$6,true,NULL,NULL)",
    [first, second, outsider, ids.version, party, otherParty],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,'review-guest',$3,'python','match',$4),($2,'review-new',$3,'java','match',$4)",
    [own, otherWorkspace, ids.version, second],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat,workspace_id) VALUES($1,'review-guest',1,NULL),($2,'review-guest',1,$4),($2,'review-new',2,$5),($3,'review-guest',1,NULL)",
    [first, second, outsider, own, otherWorkspace],
  );
  const guest = await run((scope) => guestRepository(scope).lookup("match", "review-guest-token"));
  const newcomer = await run((scope) => guestRepository(scope).lookup("match", "review-new-token"));
  assert.ok(guest && newcomer);
  assert.deepEqual(guest.scope, { kind: "party", partyId: party });
  const allowed = (who: typeof guest, match: string) =>
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        guestMayReadMatch(tx, who, match),
      ),
    );
  assert.equal(await allowed(guest, first), true);
  assert.equal(await allowed(guest, second), true);
  assert.equal(await allowed(guest, outsider), false);
  assert.equal(await allowed(newcomer, first), false);
  assert.equal(await run((scope) => guestRepository(scope).endMatch("review-guest-token")), false);
  assert.equal((await workspaceRepository(run).read(guest, own)).id, own);
  await assert.rejects(workspaceRepository(run).read(guest, otherWorkspace), { status: 404 });
  await assert.rejects(repo.read(newcomer, first), { status: 404 });
  const submission = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases,result) VALUES($1,'review-new',$2,$3,1,'submit','shared-source','hash','completed','[]','{\"verdict\":\"accepted\"}')",
    [submission, otherWorkspace, second],
  );
  await assert.rejects(repo.read(guest, second), { status: 404 });
  await pool.query(
    "UPDATE matches SET state='completed',completed_at=now(),outcome='{}' WHERE id=$1",
    [second],
  );
  assert.equal(
    JSON.parse(await repo.read(guest, second)).participants[1].submission.source,
    "shared-source",
  );
  await pool.query("UPDATE matches SET share_code_after_match=false WHERE id=$1", [second]);
  assert.equal(JSON.parse(await repo.read(guest, second)).participants.length, 1);
  await pool.query("UPDATE matches SET state='active',completed_at=NULL,outcome=NULL WHERE id=$1", [
    second,
  ]);
  await pool.query("UPDATE problems SET owner_id='review-a' WHERE id=$1", [ids.problem]);
  assert.ok(
    await problemQueries(run).byVersion(
      { userId: guest.userId, guestScope: guest.scope },
      ids.version,
    ),
  );
  assert.equal(
    await problemQueries(run).byVersion(
      { userId: newcomer.userId, guestScope: { kind: "party", partyId: otherParty } },
      ids.version,
    ),
    null,
  );
  await pool.query(
    "UPDATE guest_sessions SET revoked_at=now() WHERE token_hash='review-guest-token'",
  );
  assert.equal(await allowed(guest, second), false);
  await pool.query(
    "UPDATE guest_sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash='review-guest-token'",
  );
  assert.equal(await allowed(guest, second), false);
});
