import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { storageProjection } from "../../problems/storage.ts";
import {
  backfillActiveRunnerInput,
  backfillHistoricalRunnerInput,
} from "../runner-inputs/legacy-backfill.ts";
import { interviewSnapshotStream } from "./stream.ts";
const url = process.env.QUOREM_INTERVIEW_INPUTS_TEST_URL;
if (url) assertRunnerFixture(url, ["/quorem_hono_interview_inputs_test"]);
it.skipIf(!url)(
  "normalizes active legacy inputs losslessly and retries without changing fixture identity",
  async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
    const host = `backfill-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      epoch = crypto.randomUUID(),
      doc = crypto.randomUUID(),
      version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
    const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    };
    const signature = {
      className: "Solution",
      methodName: "solve",
      parameters: [{ name: "text", type: "str" }],
      returnType: "str",
    };
    const fixture = {
      problem: {
        id: version,
        slug: "legacy",
        version: "1",
        title: "Legacy",
        difficulty: "easy",
        tags: [],
        companies: [],
        statementMarkdown: "Echo",
        signature,
        constraints: [],
        limits: {
          wallTimeMs: 2000,
          memoryBytes: 268435456,
          outputBytes: 65536,
          maxProcesses: 16,
          maxCollectionElements: 10000,
          maxNestingDepth: 100,
        },
        languages: [
          {
            language: "python",
            starterSource: "pass",
            runtimeRevision: "python-3.12-v1",
            harnessRevision: "quorem-harness-v2",
          },
        ],
        starterSource: "pass",
        runtimeRevision: "python-3.12-v1",
        examples: [{ args: ["a\u0000b"], expected: "a\u0000b", explanation: "public" }],
      },
      hiddenCases: [{ args: ["private\u0000value"], expected: "private\u0000value" }],
      odysseyHiddenCases: [],
      harnessRevision: "quorem-harness-v2",
      referenceSource: "secret",
      attribution: "fixture",
    };
    const stored = storageProjection(JSON.stringify(fixture));
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host],
      );
      await pool.query(
        "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,$2,'Legacy',$3::jsonb,'python','pass',$4,$5,$6,'x',$7,'y',$8)",
        [
          id,
          host,
          stored.safe,
          doc,
          epoch,
          crypto.randomUUID(),
          crypto.randomUUID(),
          stored.lossless,
        ],
      );
      await pool.query(
        "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer')",
        [id, host],
      );
      const { savePublicExamples, savePrivateCases } = await import("./public-examples.ts");
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
          await savePublicExamples(tx, id, epoch, JSON.stringify(fixture));
          await savePrivateCases(tx, id, epoch, JSON.stringify(fixture));
        }),
      );
      const normalize = () =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillActiveRunnerInput(tx, id, epoch),
          ),
        );
      expect(await normalize()).toBe(true);
      const first = (
        await pool.query(
          "SELECT a.fixture_id,i.lossless_question,i.question_epoch::text FROM interview_active_runner_inputs a JOIN interviews i ON i.id=a.session_id WHERE i.id=$1",
          [id],
        )
      ).rows[0];
      expect(first.lossless_question).toBeNull();
      await pool.query(
        "DELETE FROM interview_question_private_cases WHERE session_id=$1 AND question_epoch=$2",
        [id, epoch],
      );
      expect(await normalize()).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM interview_question_private_cases WHERE session_id=$1 AND question_epoch=$2",
            [id, epoch],
          )
        ).rows[0].n,
      ).toBe(1);
      const snapshot = await new Response(await interviewSnapshotStream(run)(actor, id)).text();
      expect(snapshot).toContain("a\\u0000b");
      expect(snapshot).toContain("private\\u0000value");
      const rows = (
        await pool.query(
          "SELECT c.channel,convert_from(b.data,'UTF8') AS data FROM runner_snapshot_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.session_id=$1 AND c.fixture_id=$2 ORDER BY channel",
          [id, first.fixture_id],
        )
      ).rows;
      expect(rows.map((row) => row.channel)).toEqual(["example", "hidden"]);
      expect(rows[1].data).toContain("private\\u0000value");
      const { sourceHash } = await import("@quorem/execution");
      const { parseInterviewExecution } =
        await import("../../../../modules/interviews/execution/command.ts");
      const { postgresInterviewAdmission } = await import("../execution/repository.ts");
      const { prearmReceipts } = await import("../../events/scheduling/prearm.ts");
      const receiptId = crypto.randomUUID(),
        jobId = crypto.randomUUID(),
        shard = 21;
      await prearmReceipts(run, "execution").create(receiptId, shard);
      const request = await parseInterviewExecution(
        JSON.stringify({
          kind: "submit",
          level: 1,
          questionEpoch: epoch,
          documentEpoch: doc,
          sourceHash: await sourceHash("pass"),
        }),
        "legacy",
      );
      await postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true })(
        actor,
        id,
        "legacy-submit",
        request,
        { receiptId, jobId, shard },
      );
      expect(
        (
          await pool.query(
            "SELECT sealed,case_count,sample_count FROM runner_job_inputs WHERE job_id=$1",
            [jobId],
          )
        ).rows[0],
      ).toEqual({ sealed: true, case_count: 1, sample_count: 1 });
      expect(await normalize()).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT fixture_id FROM interview_active_runner_inputs WHERE session_id=$1",
            [id],
          )
        ).rows[0].fixture_id,
      ).toEqual(first.fixture_id);
      expect(
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillHistoricalRunnerInput(tx, id, first.fixture_id),
          ),
        ),
      ).toBe(true);
      const archived = storageProjection(
        JSON.stringify({ ...fixture, problem: { ...fixture.problem, title: "Archive" } }),
      );
      const inserted = await pool.query(
        "WITH p AS (SELECT jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) AS fixture) INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT $1,sha256(convert_to(fixture::text,'UTF8')),fixture,$3 FROM p RETURNING id",
        [id, archived.safe, archived.lossless],
      );
      const archivedId = inserted.rows[0].id;
      for (let n = 0; n < 17; n++) {
        const sub = crypto.randomUUID(),
          historicalEpoch = crypto.randomUUID(),
          client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "INSERT INTO submissions(id,owner_id,kind,source,source_hash,state,cases,interview_id) VALUES($1,$2,'submit','pass','fixture','completed','[]',$3)",
            [sub, host, id],
          );
          await client.query(
            "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture_id,level,question_epoch) VALUES($1,$2,0,$3,$4,1,$5)",
            [sub, id, doc, archivedId, historicalEpoch],
          );
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      }
      const archive = () =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillHistoricalRunnerInput(tx, id, archivedId),
          ),
        );
      expect(await archive()).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM interview_question_private_cases c WHERE c.session_id=$1 AND EXISTS(SELECT 1 FROM interview_execution e WHERE e.session_id=c.session_id AND e.question_epoch=c.question_epoch AND e.fixture_id=$2)",
            [id, archivedId],
          )
        ).rows[0].count,
      ).toBe(16);
      expect(await archive()).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM interview_question_private_cases c WHERE c.session_id=$1 AND EXISTS(SELECT 1 FROM interview_execution e WHERE e.session_id=c.session_id AND e.question_epoch=c.question_epoch AND e.fixture_id=$2)",
            [id, archivedId],
          )
        ).rows[0].count,
      ).toBe(17);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM interview_execution WHERE session_id=$1 AND fixture_id=$2",
            [id, archivedId],
          )
        ).rows[0].count,
      ).toBe(17);
      await expect(
        pool.query("DELETE FROM interview_question_snapshots WHERE session_id=$1 AND id=$2", [
          id,
          archivedId,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await pool.end();
    }
  },
);

it.skipIf(!url)("restores staged legacy cases with cumulative refs and manual unlock", async () => {
  const { fixtureRows } = await import("../../judging/inputs/bind.ts");
  const { interviewQuestionCommands } = await import("./commands.ts");
  const pool = createNodePool({
    connectionString: url!,
    max: 4,
    connectionTimeoutMs: 3000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
  const host = `stage-${crypto.randomUUID()}`,
    candidate = `candidate-${crypto.randomUUID()}`,
    id = crypto.randomUUID(),
    epoch = crypto.randomUUID(),
    doc = crypto.randomUUID();
  const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    },
    viewer = { ...actor, userId: candidate, displayName: candidate };
  const sig = {
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "text", type: "str" }],
    returnType: "str",
  };
  const one = {
      args: [],
      calls: [{ methodName: "f", args: ["one\u0000"], expected: "one\u0000" }],
    },
    two = { args: [], calls: [{ methodName: "f", args: ["two"], expected: "two" }] };
  const fixture = {
    problem: {
      id: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      slug: "legacy-stage",
      version: "1",
      title: "Stages",
      difficulty: "easy",
      tags: [],
      companies: [],
      statementMarkdown: "Stages",
      signature: sig,
      constraints: [],
      limits: {
        wallTimeMs: 2000,
        memoryBytes: 268435456,
        outputBytes: 65536,
        maxProcesses: 16,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      },
      languages: [
        {
          language: "python",
          starterSource: "pass",
          runtimeRevision: "python-3.12-v1",
          harnessRevision: "quorem-harness-v2",
        },
      ],
      starterSource: "pass",
      runtimeRevision: "python-3.12-v1",
      examples: [],
      odyssey: {
        levels: [
          { title: "One", statementMarkdown: "One", methods: [sig], examples: [one] },
          { title: "Two", statementMarkdown: "Two", methods: [sig], examples: [two] },
        ],
      },
    },
    hiddenCases: [],
    odysseyHiddenCases: [
      [{ args: [], calls: [{ methodName: "f", args: ["secret-one"], expected: "secret-one" }] }],
      [{ args: [], calls: [{ methodName: "f", args: ["secret-two"], expected: "secret-two" }] }],
    ],
    harnessRevision: "quorem-harness-v2",
    referenceSource: "secret",
  };
  const stored = storageProjection(JSON.stringify(fixture));
  try {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1),($2,$2)", [host, candidate]);
    await pool.query(
      "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
      [crypto.randomUUID(), host],
    );
    await pool.query(
      "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,$2,'Legacy',$3::jsonb,'python','pass',$4,$5,$6,'x',$7,'y',$8)",
      [
        id,
        host,
        stored.safe,
        doc,
        epoch,
        crypto.randomUUID(),
        crypto.randomUUID(),
        stored.lossless,
      ],
    );
    await pool.query(
      "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer'),($1,$3,'interviewee')",
      [id, host, candidate],
    );
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
        backfillActiveRunnerInput(tx, id, epoch),
      ),
    );
    const fid = (
      await pool.query(
        "SELECT fixture_id FROM interview_active_runner_inputs WHERE session_id=$1",
        [id],
      )
    ).rows[0].fixture_id;
    const refs = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) => ({
          rows: (
            await tx.execute<{ stage: number; channel: string }>(
              sql`SELECT stage,channel FROM (${fixtureRows({ session: id, fixture: fid }, 2)}) c ORDER BY stage,ordinal`,
            )
          ).rows,
        }),
      ),
    );
    expect(refs.rows.filter((r) => r.channel === "example").map((r) => r.stage)).toEqual([1, 2]);
    expect(refs.rows.filter((r) => r.channel === "hidden").map((r) => r.stage)).toEqual([1, 2]);
    const read = interviewSnapshotStream(run),
      before = JSON.parse(await new Response(await read(viewer, id)).text());
    expect(before.question.problem.odyssey.levels).toHaveLength(1);
    expect(JSON.stringify(before)).not.toContain("two");
    expect(JSON.stringify(before)).not.toContain("secret-one");
    await interviewQuestionCommands(run).caseVisibility(
      actor,
      id,
      "reveal-one",
      "level:1:case:0",
      true,
      epoch,
    );
    const revealed = await new Response(await read(viewer, id)).text();
    expect(revealed).toContain("secret-one");
    expect(revealed).not.toContain("secret-two");
    await interviewQuestionCommands(run).passStage(actor, id, "stage-key", epoch, 1);
    const after = JSON.parse(await new Response(await read(viewer, id)).text());
    expect(after.question.problem.odyssey.levels).toHaveLength(2);
    expect(JSON.stringify(after)).toContain("two");
  } finally {
    await pool.end();
  }
});

it.skipIf(!url)("rolls back when legacy public metadata and private source disagree", async () => {
  const pool = createNodePool({
    connectionString: url!,
    max: 2,
    connectionTimeoutMs: 3000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
  const host = `conflict-${crypto.randomUUID()}`,
    id = crypto.randomUUID(),
    epoch = crypto.randomUUID();
  const raw =
    '{"problem":{"id":"e91ec728-4597-5dfb-9d19-7c4ba17138b7","examples":[]},"hiddenCases":[{"args":["x\\u0000"],"expected":1}],"odysseyHiddenCases":[]}';
  const safe = JSON.stringify({
    problem: { id: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", examples: [] },
    hiddenCases: [],
    odysseyHiddenCases: [],
  });
  try {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
    await pool.query(
      "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,$2,'Conflict',$3::jsonb,'python','pass',$4,$5,$6,'x',$7,'y',convert_to($8,'UTF8'))",
      [id, host, safe, crypto.randomUUID(), epoch, crypto.randomUUID(), crypto.randomUUID(), raw],
    );
    await expect(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
          backfillActiveRunnerInput(tx, id, epoch),
        ),
      ),
    ).rejects.toThrow("shape conflict");
    const state = (
      await pool.query(
        "SELECT lossless_question IS NOT NULL AS retained,(SELECT count(*)::int FROM interview_question_snapshots WHERE session_id=$1) AS snapshots,(SELECT count(*)::int FROM interview_active_runner_inputs WHERE session_id=$1) AS mappings FROM interviews WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(state).toEqual({ retained: true, snapshots: 0, mappings: 0 });
  } finally {
    await pool.end();
  }
});

it.skipIf(!url)(
  "matches fresh and backfilled source, metadata and case hashes across lossless spellings",
  async () => {
    const { saveInterviewFixture } = await import("../execution/fixture.ts");
    const pool = createNodePool({
      connectionString: url!,
      max: 3,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
    const host = `diff-${crypto.randomUUID()}`,
      fresh = crypto.randomUUID(),
      legacy = crypto.randomUUID();
    const raw =
      ' { "hiddenCases" : [{ "expected":1e309, "args":["é\\u0000\\u0061"] }], "problem" : { "id":"e91ec728-4597-5dfb-9d19-7c4ba17138b7", "signature":{"className":"Solution","methodName":"f","parameters":[],"returnType":"str"}, "constraints":[], "limits":{}, "examples":[{"expected":9007199254740993,"args":["é\\u0000\\u0061"]}] }, "odysseyHiddenCases":[] } ';
    const stored = storageProjection(raw);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      for (const id of [fresh, legacy])
        await pool.query(
          "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Hash',$3::jsonb,'python','pass',$4,$5,$6,'x',$7,'y')",
          [
            id,
            host,
            stored.safe,
            crypto.randomUUID(),
            crypto.randomUUID(),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        );
      const fid = await run((scope) =>
        scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
          saveInterviewFixture(tx, fresh, raw),
        ),
      );
      await pool.query(
        "WITH p AS (SELECT jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) AS fixture) INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT $1,sha256(convert_to(fixture::text,'UTF8')),fixture,$3 FROM p",
        [legacy, stored.safe, stored.lossless],
      );
      expect(
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillHistoricalRunnerInput(tx, legacy, fid),
          ),
        ),
      ).toBe(true);
      const records = await pool.query(
        "SELECT session_id::text,encode(metadata_hash,'hex') AS metadata,encode(fixture_hash,'hex') AS source FROM runner_snapshot_inputs WHERE session_id=ANY($1::uuid[]) ORDER BY session_id",
        [[fresh, legacy]],
      );
      expect(records.rows).toHaveLength(2);
      expect(records.rows[0].metadata).toBe(records.rows[1].metadata);
      expect(records.rows[0].source).toBe(records.rows[1].source);
      const refs = await pool.query(
        "SELECT session_id::text,channel,stage,ordinal,encode(blob_hash,'hex') AS hash FROM runner_snapshot_input_cases WHERE session_id=ANY($1::uuid[]) ORDER BY channel,stage,ordinal,session_id",
        [[fresh, legacy]],
      );
      expect(refs.rows).toHaveLength(4);
      expect(refs.rows[0].hash).toBe(refs.rows[1].hash);
      expect(refs.rows[2].hash).toBe(refs.rows[3].hash);
      expect(
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillHistoricalRunnerInput(tx, legacy, fid),
          ),
        ),
      ).toBe(true);
    } finally {
      await pool.end();
    }
  },
);
