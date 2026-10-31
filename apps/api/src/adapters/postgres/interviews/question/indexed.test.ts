import { expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { interviewQuestionCommands } from "./commands.ts";
import { interviewSnapshotStream } from "./stream.ts";
const url = process.env.QUOREM_INTERVIEW_INPUTS_TEST_URL;
it.skipIf(!url)(
  "pins indexed question selection and switches language without fetching fixture",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55571",
      "/quorem_hono_interview_inputs_test",
    ]);
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const host = `indexed-${crypto.randomUUID()}`;
    const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "test",
      strongUntil: 0,
    };
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host],
      );
      const read = interviewSnapshotStream(run),
        lifecycle = interviewLifecycle(run, {
          question: preparePublishedInterviewQuestion,
          snapshot: read,
        });
      const command = {
        title: "Indexed",
        question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
      };
      const id = JSON.parse(await lifecycle.create(actor, "create-key", command)).id;
      const state = await pool.query(
        "SELECT document_epoch::text,question_epoch::text FROM interviews WHERE id=$1",
        [id],
      );
      const epoch = state.rows[0].document_epoch;
      const mapping = await pool.query(
        "SELECT s.sealed FROM interview_active_runner_inputs a JOIN runner_snapshot_inputs s ON s.session_id=a.session_id AND s.fixture_id=a.fixture_id WHERE a.session_id=$1 AND a.question_epoch=$2",
        [id, state.rows[0].question_epoch],
      );
      expect(mapping.rows).toEqual([{ sealed: true }]);
      const { backfillActiveRunnerInput } = await import("../runner-inputs/legacy-backfill.ts");
      await pool.query(
        "DELETE FROM interview_public_examples WHERE session_id=$1 AND question_epoch=$2 AND level=0",
        [id, state.rows[0].question_epoch],
      );
      expect(
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
            backfillActiveRunnerInput(tx, id, state.rows[0].question_epoch),
          ),
        ),
      ).toBe(true);
      const snapshot = JSON.parse(await new Response(await read(actor, id)).text());
      expect(snapshot.question.problem.examples.length).toBeGreaterThan(0);
      const question = interviewQuestionCommands(run);
      await question.language(actor, id, "language-key", "java", epoch);
      const switched = await pool.query(
        "SELECT language,document_version FROM interviews WHERE id=$1",
        [id],
      );
      expect(switched.rows[0].language).toBe("java");
      expect(JSON.parse(await lifecycle.create(actor, "create-key", command)).id).toBe(id);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'questions.custom','manual','test','test','test')",
        [crypto.randomUUID(), host],
      );
      await question.select(actor, id, "custom-key", {
        language: "python",
        custom: {
          title: "Echo",
          statementMarkdown: "Echo text",
          signature: {
            className: "Solution",
            methodName: "echo",
            parameters: [{ name: "text", type: "str" }],
            returnType: "str",
          },
          publicCases: [{ args: ["a\u0000b"], expected: "a\u0000b" }],
          privateCases: [],
        },
      });
      const custom = await pool.query(
        "SELECT i.question_epoch::text,a.fixture_id, (SELECT count(*)::int FROM interview_question_private_cases c WHERE c.session_id=i.id AND c.question_epoch=i.question_epoch) AS private_count,(SELECT count(*)::int FROM runner_snapshot_input_cases c WHERE c.session_id=a.session_id AND c.fixture_id=a.fixture_id AND c.channel='hidden') AS indexed_hidden FROM interviews i JOIN interview_active_runner_inputs a ON a.session_id=i.id WHERE i.id=$1",
        [id],
      );
      expect(custom.rows[0]).toMatchObject({ private_count: 0, indexed_hidden: 0 });
      const customSnapshot = await new Response(await read(actor, id)).text();
      expect(customSnapshot).toContain("a\\u0000b");
      const { seedQuestion } = await import("../../../../cli/seed-question.ts");
      const { fileURLToPath } = await import("node:url");
      const stagedVersion = await seedQuestion(
        pool,
        host,
        "private",
        fileURLToPath(
          new URL("../../../../../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
        ),
      );
      await question.select(actor, id, "stage-select", {
        problemVersionId: stagedVersion,
        language: "python",
      });
      const before = JSON.parse(await new Response(await read(actor, id)).text());
      expect(before.question.problem.odyssey.levels).toHaveLength(1);
      const cases = await pool.query(
        "SELECT case_id FROM interview_question_private_cases WHERE session_id=$1 AND question_epoch=$2 ORDER BY ordinal",
        [id, before.questionEpoch],
      );
      expect(cases.rows.some((row) => row.case_id.startsWith("level:1:case:"))).toBe(true);
      expect(cases.rows.some((row) => row.case_id.startsWith("level:2:case:"))).toBe(true);
      await question.passStage(actor, id, "stage-pass", before.questionEpoch, 1);
      const after = JSON.parse(await new Response(await read(actor, id)).text());
      expect(after.question.problem.odyssey.levels).toHaveLength(2);
      expect(after.questionEpoch).toBe(before.questionEpoch);
      await Promise.all([
        question.select(actor, id, "race-one", {
          problemVersionId: stagedVersion,
          language: "python",
        }),
        question.select(actor, id, "race-two", {
          problemVersionId: stagedVersion,
          language: "java",
        }),
      ]);
      const fenced = await pool.query(
        "SELECT a.question_epoch=i.question_epoch AS current FROM interviews i JOIN interview_active_runner_inputs a ON a.session_id=i.id WHERE i.id=$1",
        [id],
      );
      expect(fenced.rows).toEqual([{ current: true }]);
    } finally {
      await pool.end();
    }
  },
);

it.skipIf(!url)(
  "seals only an unchanged version and retains immutable child behavior",
  async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const parent = crypto.randomUUID(),
      id = crypto.randomUUID(),
      base = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
    try {
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [parent, `seal-${parent}`]);
      await pool.query(
        "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_public) SELECT $1,$2,1,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,convert_to('raw','UTF8') FROM problem_versions WHERE id=$3",
        [id, parent, base],
      );
      await pool.query(
        "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,'[]','1')",
        [id],
      );
      await expect(
        pool.query("UPDATE problem_versions SET sealed=true,title='changed' WHERE id=$1", [id]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query(
          "UPDATE problem_versions SET sealed=true,lossless_public=convert_to('different','UTF8') WHERE id=$1",
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [id]);
      await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [id]);
      await expect(
        pool.query("UPDATE problem_versions SET title='changed' WHERE id=$1", [id]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query("UPDATE problem_examples SET expected='2'::jsonb WHERE version_id=$1", [id]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await pool.end();
    }
  },
);

it.skipIf(!url)(
  "scans a locked legacy fixture in pages and fences concurrent replacement",
  async () => {
    const { openLegacyFixtureRanges } = await import("../runner-inputs/legacy-ranges.ts");
    const pool = createNodePool({
      connectionString: url!,
      max: 3,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const host = `legacy-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      epoch = crypto.randomUUID();
    const raw =
      '{"problem":{"examples":[{"args":["é\\u0000"],"expected":9007199254740993}]},"hiddenCases":[{"args":["private"],"expected":1}]}';
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      await pool.query(
        "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question) VALUES($1,$2,'Legacy','{}','python','',$3,$4,$5,'x',$6,'y',convert_to($7,'UTF8'))",
        [id, host, crypto.randomUUID(), epoch, crypto.randomUUID(), crypto.randomUUID(), raw],
      );
      let update: Promise<unknown> | undefined;
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          const opened = await openLegacyFixtureRanges(tx, { session: id, epoch });
          expect(opened.ranges.cases).toHaveLength(2);
          expect(await opened.readCase(opened.ranges.cases[0])).toContain("é\\u0000");
          expect(await opened.readCase(opened.ranges.cases[1])).toContain("private");
          let done = false;
          update = pool
            .query("UPDATE interviews SET lossless_question=convert_to('{}','UTF8') WHERE id=$1", [
              id,
            ])
            .finally(() => {
              done = true;
            });
          await new Promise((resolve) => setTimeout(resolve, 40));
          expect(done).toBe(false);
          expect(await opened.verify()).toBe(true);
        }),
      );
      await update;
    } finally {
      await pool.end();
    }
  },
);
