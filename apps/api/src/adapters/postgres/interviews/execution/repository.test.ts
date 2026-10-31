import { expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { sourceHash } from "@quorem/execution";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { parseInterviewExecution } from "../../../../modules/interviews/execution/command.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshot } from "../question/snapshot.ts";
import { interviewDocumentCommands } from "../document/commands.ts";
import { interviewQuestionCommands } from "../question/commands.ts";
import { submissionSnapshots } from "../../judging/results/repository.ts";
import { interviewExecutionFingerprint } from "./fingerprint.ts";
import { postgresInterviewAdmission } from "./repository.ts";
import { saveInterviewFixture } from "./fixture.ts";
const url = process.env.QUOREM_INTERVIEW_EXECUTION_TEST_URL;
const actor = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
it("matches Go raw case fingerprint", async () => {
  const raw = String.raw`{"kind":"run","level":1,"customCases":[{"args":["\u0061"],"expected":"\u0062"}],"questionEpoch":"00000000-0000-4000-8000-000000000001","documentEpoch":"00000000-0000-4000-8000-000000000002","sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`;
  expect(
    await interviewExecutionFingerprint("room", await parseInterviewExecution(raw, "key")),
  ).toBe("8c6efde0b616be2f3d8e66148ab33aa17e805884a397ee46d19651566bbc1c4e");
});
it.skipIf(!url)("atomically admits locked source and replays after edits", async () => {
  const db = new URL(url!);
  expect([db.hostname, db.port, db.pathname]).toEqual([
    "127.0.0.1",
    "55470",
    "/quorem_hono_interview_execution_test",
  ]);
  const pool = createNodePool({
      connectionString: url!,
      max: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    }),
    host = actor(`exec-host-${crypto.randomUUID()}`),
    candidate = actor(`exec-candidate-${crypto.randomUUID()}`);
  try {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host'),($2,'Candidate')", [
      host.userId,
      candidate.userId,
    ]);
    await pool.query(
      "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
      [crypto.randomUUID(), host.userId],
    );
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    const lifecycle = interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: interviewSnapshot,
      }),
      docs = interviewDocumentCommands(run),
      commands = interviewQuestionCommands(run),
      admit = postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true });
    const room = JSON.parse(
      await lifecycle.read(
        host,
        JSON.parse(
          await lifecycle.create(host, "create", {
            title: "Admission",
            question: {
              problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
              language: "python",
            },
          }),
        ).id,
      ),
    );
    const fixtureRaw = String.raw`{"problem":{"examples":[{"args":["a\u0000b"]}]}}`;
    const fixtureId = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        saveInterviewFixture(tx, room.id, fixtureRaw),
      ),
    );
    const fixtureAgain = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        saveInterviewFixture(tx, room.id, fixtureRaw),
      ),
    );
    expect(fixtureId).toEqual(fixtureAgain);
    const saved = (
      await pool.query(
        "SELECT encode(id,'hex') AS id,encode(sha256(convert_to(fixture::text,'UTF8')),'hex') AS expected,convert_from(lossless_fixture,'UTF8') AS raw FROM interview_question_snapshots WHERE session_id=$1 AND id=$2",
        [room.id, fixtureId],
      )
    ).rows[0];
    expect(saved.id).toBe(saved.expected);
    expect(saved.raw).toBe(fixtureRaw);
    await pool.query(
      "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewee')",
      [room.id, candidate.userId],
    );
    const raw = JSON.stringify({
        kind: "run",
        level: 1,
        questionEpoch: room.questionEpoch,
        documentEpoch: room.document.epoch,
        sourceHash: await sourceHash(room.document.source),
      }),
      command = await parseInterviewExecution(raw, "admit");
    const fence = async () => {
      const receiptId = crypto.randomUUID(),
        jobId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
        [receiptId],
      );
      return { receiptId, jobId, shard: 0 };
    };
    const first = await admit(candidate, room.id, "admit", command, await fence());
    expect(first.state).toBe("queued");
    const row = (
      await pool.query(
        "SELECT s.source,s.source_hash,e.document_epoch::text,e.question_epoch::text,q.id, count(x.level)::int AS examples FROM submissions s JOIN interview_execution e ON e.submission_id=s.id JOIN interview_question_snapshots q ON q.session_id=e.session_id AND q.id=e.fixture_id JOIN interview_snapshot_public_examples x ON x.session_id=q.session_id AND x.fixture_id=q.id WHERE s.id=$1 GROUP BY s.id,e.document_epoch,e.question_epoch,q.id",
        [first.id],
      )
    ).rows[0];
    expect(row.source).toBe(room.document.source);
    expect(row.source_hash).toBe(command.sourceHash);
    expect(row.examples).toBeGreaterThan(0);
    await docs.push(host, room.id, "edit", {
      epoch: room.document.epoch,
      version: 0,
      updates: [{ clientID: "host", changes: [[0, "x"], room.document.source.length] }],
    });
    const replay = await admit(candidate, room.id, "admit", command, await fence());
    expect(replay.id).toBe(first.id);
    await expect(admit(candidate, room.id, "new", command, await fence())).rejects.toMatchObject({
      code: "document_changed",
    });
    expect(
      (
        (await new Response(
          await submissionSnapshots(run).interview(candidate, room.id, first.id),
        ).json()) as { id: string }
      ).id,
    ).toBe(first.id);
    await pool.query(
      "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2",
      [room.id, candidate.userId],
    );
    await expect(admit(candidate, room.id, "admit", command, await fence())).rejects.toMatchObject({
      status: 404,
    });
    expect(commands).toBeDefined();
  } finally {
    await pool.end();
  }
});

it.skipIf(!url)("accepted interview promotion cannot auto-advance a manual stage", async () => {
  const pool = createNodePool({
      connectionString: url!,
      max: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    }),
    host = actor(`stage-host-${crypto.randomUUID()}`);
  try {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host')", [host.userId]);
    await pool.query(
      "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','x','test','test'),($3,$2,'questions.custom','manual','y','test','test')",
      [crypto.randomUUID(), host.userId, crypto.randomUUID()],
    );
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    const lifecycle = interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: interviewSnapshot,
      }),
      questions = interviewQuestionCommands(run),
      admit = postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true });
    const room = JSON.parse(
      await lifecycle.read(
        host,
        JSON.parse(
          await lifecycle.create(host, "create", {
            title: "Stages",
            question: {
              problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
              language: "python",
            },
          }),
        ).id,
      ),
    );
    const sig = {
        className: "Solution",
        methodName: "put",
        parameters: [{ name: "n", type: "int" }],
        returnType: "int",
      },
      one = { args: [], calls: [{ methodName: "put", args: [1], expected: 1 }] };
    const staged = {
      title: "Stages",
      statementMarkdown: "Implement",
      signature: sig,
      odyssey: {
        levels: [
          { title: "One", statementMarkdown: "One", methods: [sig], examples: [one] },
          {
            title: "Two",
            statementMarkdown: "Two",
            methods: [{ ...sig, methodName: "next" }],
            examples: [one],
          },
        ],
      },
      odysseyHiddenCases: [[one], [one]],
    };
    const selected = JSON.parse(
      await lifecycle.read(
        host,
        JSON.parse(
          await questions.select(host, room.id, "select", { language: "python", custom: staged }),
        ).id,
      ),
    );
    const raw = JSON.stringify({
      kind: "submit",
      level: 1,
      questionEpoch: selected.questionEpoch,
      documentEpoch: selected.document.epoch,
      sourceHash: await sourceHash(selected.document.source),
    });
    const receiptId = crypto.randomUUID(),
      jobId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
      [receiptId],
    );
    const submission = await admit(
      host,
      room.id,
      "submit",
      await parseInterviewExecution(raw, "submit"),
      { receiptId, jobId, shard: 0 },
    );
    await pool.query(
      "UPDATE execution_jobs SET finished=true WHERE id<>$1 AND attempt_id IS NULL",
      [jobId],
    );
    const { postgresClaims } = await import("../../judging/worker/claim.ts"),
      { postgresCompletionStaging } = await import("../../judging/worker/staging.ts"),
      { postgresCompletionPromotion } = await import("../../judging/worker/promote.ts");
    const claims = postgresClaims(run, {
        resumable: true,
        losslessCases: true,
        losslessResults: true,
      }),
      job = await claims.claimAfterTeardown(true, "stage-sandbox", null);
    expect(job?.submissionId).toBe(submission.id);
    const staging = postgresCompletionStaging(run);
    await staging.begin(job!, {
      submissionId: submission.id,
      attemptId: job!.attemptId,
      verdict: "accepted",
      score: { passed: 1, total: 1 },
      engineFailure: false,
      diagnosticsPresent: false,
      publicPresent: false,
      samplePresent: true,
      privatePresent: true,
      publicCount: 0,
      sampleCount: 1,
      privateCount: 1,
    });
    for (const channel of ["sample", "private"] as const) {
      await staging.chunk(job!, {
        channel,
        ordinal: 0,
        field: "actual",
        chunkOrdinal: 0,
        bytes: new TextEncoder().encode("[1]"),
      });
      await staging.seal(job!, channel, 0, "executed");
    }
    await staging.eof(job!, job!);
    await postgresCompletionPromotion(run)(job!, job!);
    expect(JSON.parse(await lifecycle.read(host, room.id)).question.progress.level).toBe(1);
    const candidate = actor(`stage-candidate-${crypto.randomUUID()}`);
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Candidate')", [
      candidate.userId,
    ]);
    await pool.query(
      "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewee')",
      [room.id, candidate.userId],
    );
    const snapshots = submissionSnapshots(run);
    const staff = await new Response(
      await snapshots.interview(host, room.id, submission.id),
    ).text();
    const hidden = await new Response(
      await snapshots.interview(candidate, room.id, submission.id),
    ).text();
    expect(staff).toContain("privateCaseResults");
    expect(hidden).not.toContain("privateCaseResults");
    const caseId = (
      await pool.query(
        "SELECT case_id FROM interview_question_private_cases WHERE session_id=$1 AND question_epoch=$2 ORDER BY ordinal LIMIT 1",
        [room.id, selected.questionEpoch],
      )
    ).rows[0].case_id;
    await questions.caseVisibility(host, room.id, "show", caseId, true, selected.questionEpoch);
    expect(
      await new Response(await snapshots.interview(candidate, room.id, submission.id)).text(),
    ).toContain("privateCaseResults");
    const receipt2 = crypto.randomUUID(),
      job2id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
      [receipt2],
    );
    const second = await admit(
      host,
      room.id,
      "submit-two",
      await parseInterviewExecution(raw, "submit-two"),
      { receiptId: receipt2, jobId: job2id, shard: 0 },
    );
    const job2 = await claims.claimAfterTeardown(true, "stage-sandbox", null);
    expect(job2?.submissionId).toBe(second.id);
    await staging.begin(job2!, {
      submissionId: second.id,
      attemptId: job2!.attemptId,
      verdict: "accepted",
      score: { passed: 1, total: 1 },
      engineFailure: false,
      diagnosticsPresent: false,
      publicPresent: false,
      samplePresent: true,
      privatePresent: true,
      publicCount: 0,
      sampleCount: 1,
      privateCount: 1,
    });
    for (const channel of ["sample", "private"] as const) {
      await staging.chunk(job2!, {
        channel,
        ordinal: 0,
        field: "actual",
        chunkOrdinal: 0,
        bytes: new TextEncoder().encode("[1]"),
      });
      await staging.seal(job2!, channel, 0, "executed");
    }
    await staging.eof(job2!, job2!);
    const [, passedRaw] = await Promise.all([
      postgresCompletionPromotion(run)(job2!, job2!),
      questions.passStage(host, room.id, "pass", selected.questionEpoch, 1),
    ]);
    expect(JSON.parse(passedRaw)).toEqual({ id: room.id });
    expect(JSON.parse(await lifecycle.read(host, room.id)).question.progress.level).toBe(2);
    const receipt3 = crypto.randomUUID();
    await pool.query(
      "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
      [receipt3],
    );
    await expect(
      admit(host, room.id, "stale-stage", await parseInterviewExecution(raw, "stale-stage"), {
        receiptId: receipt3,
        jobId: crypto.randomUUID(),
        shard: 0,
      }),
    ).rejects.toMatchObject({ code: "stage_changed" });
    const oldReplay = crypto.randomUUID();
    await pool.query(
      "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
      [oldReplay],
    );
    expect(
      (
        await admit(host, room.id, "submit", await parseInterviewExecution(raw, "submit"), {
          receiptId: oldReplay,
          jobId: crypto.randomUUID(),
          shard: 0,
        })
      ).id,
    ).toBe(submission.id);
  } finally {
    await pool.end();
  }
});
