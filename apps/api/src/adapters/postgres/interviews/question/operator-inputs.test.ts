import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { storageProjection } from "../../problems/storage.ts";
import { backfillInterviewCases } from "../../../../cli/backfill-interview-cases.ts";
const url = process.env.QUOREM_INTERVIEW_OPERATOR_TEST_URL;
it.skipIf(!url)(
  "requires verified operator, rolls dry run back, audits and safely retries",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55571",
      "/quorem_hono_interview_inputs_operator_test",
    ]);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const user = "runner-input-test-operator",
      subject = "runner-input-test-subject",
      id = crypto.randomUUID(),
      epoch = crypto.randomUUID(),
      op = `inputs-${crypto.randomUUID()}`,
      issuer = "https://operator.test";
    const priorURL = process.env.QUOREM_OPERATOR_DATABASE_URL,
      priorIssuer = process.env.AUTH_ORIGIN;
    const fixture = {
      problem: {
        id: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
        slug: "legacy",
        version: "1",
        title: "Legacy",
        difficulty: "easy",
        statementMarkdown: "test",
        signature: {
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type: "str" }],
          returnType: "str",
        },
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
        examples: [{ args: ["a\u0000b"], expected: "a\u0000b" }],
      },
      hiddenCases: [{ args: ["private"], expected: "private" }],
      odysseyHiddenCases: [],
      harnessRevision: "quorem-harness-v2",
      referenceSource: "secret",
    };
    const stored = storageProjection(JSON.stringify(fixture));
    try {
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES($1,$1,'admin') ON CONFLICT(id) DO NOTHING",
        [user],
      );
      await pool.query(
        'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,clock_timestamp(),clock_timestamp()) ON CONFLICT(id) DO NOTHING',
        [subject, `${subject}@example.test`],
      );
      await pool.query(
        "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [issuer, subject, user],
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator',$1,$1,'bootstrap',$2,'fixture') ON CONFLICT DO NOTHING",
        [user, subject],
      );
      await pool.query(
        "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,$2,'Legacy',$3::jsonb,'python','pass',$4,$5,$6,'x',$7,'y',$8)",
        [
          id,
          user,
          stored.safe,
          crypto.randomUUID(),
          epoch,
          crypto.randomUUID(),
          crypto.randomUUID(),
          stored.lossless,
        ],
      );
      process.env.QUOREM_OPERATOR_DATABASE_URL = url!;
      process.env.AUTH_ORIGIN = "https://wrong.test";
      const args = ["--op-id", op, "--reason", "fixture", "--limit", "4", "--max-batches", "4"];
      await expect(backfillInterviewCases([...args, "--dry-run"])).rejects.toThrow(
        "Verified operator binding required",
      );
      process.env.AUTH_ORIGIN = issuer;
      const dry = await backfillInterviewCases([...args, "--dry-run"]);
      expect(dry).toMatchObject({ attempted: 1, completed: 1, dryRun: true });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM interview_active_runner_inputs WHERE session_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query("SELECT count(*)::int AS n FROM access_audit WHERE operation_id=$1", [
            op,
          ])
        ).rows[0].n,
      ).toBe(0);
      await expect(backfillInterviewCases(args)).rejects.toThrow("Drain legacy writers and judges");
      const actual = await backfillInterviewCases([...args, "--legacy-drained"]);
      expect(actual).toMatchObject({ attempted: 1, completed: 1, complete: true, dryRun: false });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM interview_active_runner_inputs WHERE session_id=$1 AND question_epoch=$2",
            [id, epoch],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (await pool.query("SELECT action FROM access_audit WHERE operation_id=$1", [op])).rows[0]
          .action,
      ).toBe("interviews.runner-inputs.backfill");
      expect((await backfillInterviewCases([...args, "--legacy-drained"])).complete).toBe(true);
      const privateOp = `private-${crypto.randomUUID()}`;
      expect(
        (
          await backfillInterviewCases([
            "--op-id",
            privateOp,
            "--reason",
            "private repair",
            "--private-results",
            "--legacy-drained",
          ])
        ).complete,
      ).toBe(true);
      expect(
        (await pool.query("SELECT action FROM access_audit WHERE operation_id=$1", [privateOp]))
          .rows[0].action,
      ).toBe("interviews.private-results.backfill");
      await expect(
        backfillInterviewCases([
          "--legacy-drained",
          "--op-id",
          op,
          "--reason",
          "different",
          "--limit",
          "4",
          "--max-batches",
          "4",
        ]),
      ).rejects.toThrow("Operation ID already used");
      const job = crypto.randomUUID(),
        submission = crypto.randomUUID(),
        doc = (await pool.query("SELECT document_epoch::text FROM interviews WHERE id=$1", [id]))
          .rows[0].document_epoch;
      const fixtureId = (
        await pool.query(
          "SELECT fixture_id FROM interview_active_runner_inputs WHERE session_id=$1",
          [id],
        )
      ).rows[0].fixture_id;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO submissions(id,owner_id,kind,source,source_hash,state,cases,interview_id) VALUES($1,$2,'run','pass','fixture','queued','[]',$3)",
          [submission, user, id],
        );
        await client.query(
          "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture_id,level,question_epoch) VALUES($1,$2,0,$3,$4,1,$5)",
          [submission, id, doc, fixtureId, epoch],
        );
        await client.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
          job,
          submission,
        ]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const pendingArgs = [
        "--legacy-drained",
        "--op-id",
        `${op}-pending`,
        "--reason",
        "pending",
        "--limit",
        "4",
        "--max-batches",
        "4",
      ];
      await expect(backfillInterviewCases(pendingArgs)).rejects.toThrow(
        "Legacy interview jobs must drain",
      );
      expect(
        (await pool.query("SELECT finished FROM execution_jobs WHERE id=$1", [job])).rows[0]
          .finished,
      ).toBe(false);
      await pool.query("UPDATE execution_jobs SET finished=true WHERE id=$1", [job]);
      await pool.query("UPDATE submissions SET state='cancelled' WHERE id=$1", [submission]);
      expect((await backfillInterviewCases(pendingArgs)).complete).toBe(true);
    } finally {
      if (priorURL === undefined) delete process.env.QUOREM_OPERATOR_DATABASE_URL;
      else process.env.QUOREM_OPERATOR_DATABASE_URL = priorURL;
      if (priorIssuer === undefined) delete process.env.AUTH_ORIGIN;
      else process.env.AUTH_ORIGIN = priorIssuer;
      await pool.end();
    }
  },
);
