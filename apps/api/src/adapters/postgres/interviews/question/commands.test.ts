import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { describe, expect, it } from "vitest";
import { parseLosslessJson } from "@quorem/questions";
import { interviewQuestionOperationFingerprint } from "../../../../modules/interviews/question/fingerprint.ts";
import { fingerprintQuestionInput } from "./fingerprint-input.ts";
import { migrate } from "@quorem/database/migrations";
import { backfillInterviewCases } from "../../../../cli/backfill-interview-cases.ts";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { interviewSnapshotStream } from "./stream.ts";
import { questionAuthoring } from "../../problems/authoring/repository.ts";
import { languageRuntime } from "@quorem/execution";
import { interviewQuestionCommands } from "./commands.ts";
const url = process.env.QUOREM_INTERVIEW_QUESTIONS_TEST_URL;
if (url)
  assertRunnerFixture(url, [
    "/quorem_hono_interview_questions_test",
    "/quorem_hono_29c_commands_test",
  ]);
const actor = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
describe.skipIf(!url)("interview question commands on PostgreSQL", () => {
  it("fences question, document, disclosure and host stage transitions", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const host = actor(`host-${crypto.randomUUID()}`),
      viewer = actor(`viewer-${crypto.randomUUID()}`),
      interviewer = actor(`interviewer-${crypto.randomUUID()}`);
    try {
      await pool.query(
        "INSERT INTO users(id,display_name) VALUES($1,'Host'),($2,'Viewer'),($3,'Interviewer')",
        [host.userId, viewer.userId, interviewer.userId],
      );
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','i','test','test'),($3,$2,'questions.custom','manual','q','test','test')",
        [crypto.randomUUID(), host.userId, crypto.randomUUID()],
      );
      const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, f);
      const lifecycle = interviewLifecycle(run, {
          question: preparePublishedInterviewQuestion,
          snapshot: interviewSnapshotStream(run),
        }),
        commands = interviewQuestionCommands(run);
      const created = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await lifecycle.create(host, "create", {
                title: "Question controls",
                question: {
                  problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
                  language: "python",
                },
              }),
            ).id,
          ),
        ).text(),
      );
      const id = created.id;
      await pool.query(
        "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewee'),($1,$3,'interviewer')",
        [id, viewer.userId, interviewer.userId],
      );
      const escaped = String.raw`{"language":"python","custom":{"title":"X","statementMarkdown":"Return input","signature":{"className":"Solution","methodName":"echo","parameters":[{"name":"x","type":"str"}],"returnType":"str"},"publicCases":[{"args":["\u0061"],"expected":"\u0061"}],"privateCases":[{"args":["\u0062"],"expected":"\u0062"}]}}`;
      const input = fingerprintQuestionInput(parseLosslessJson(escaped), escaped, false),
        fingerprint = await interviewQuestionOperationFingerprint(
          `${id}:question`,
          input.question,
          input.marks,
        );
      await pool.query(
        "INSERT INTO interview_operations(owner_id,key,fingerprint,session_id) VALUES($1,'go-replay',$2,$3)",
        [host.userId, fingerprint, id],
      );
      expect(
        JSON.parse(
          await new Response(
            await lifecycle.read(
              host,
              JSON.parse(
                await commands.select(host, id, "go-replay", parseLosslessJson(escaped), escaped),
              ).id,
            ),
          ).text(),
        ).questionEpoch,
      ).toBe(created.questionEpoch);
      const candidate = await new Response(await lifecycle.read(viewer, id)).text();
      expect(candidate).not.toContain("privateCaseDetails");
      expect(candidate).not.toContain("referenceSource");
      const hint = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(await commands.hints(host, id, "hints", { topics: false, complexity: true }))
              .id,
          ),
        ).text(),
      );
      expect(hint.hints).toEqual({ topics: false, complexity: true });
      await expect(
        commands.hints(interviewer, id, "bad-hints", { topics: true }),
      ).rejects.toMatchObject({ status: 403 });
      const old = hint.document.epoch;
      const switched = JSON.parse(
        await new Response(
          await lifecycle.read(
            viewer,
            JSON.parse(await commands.language(viewer, id, "java", "java", old)).id,
          ),
        ).text(),
      );
      expect(switched.question.language).toBe("java");
      expect(switched.document.epoch).not.toBe(old);
      await expect(commands.language(viewer, id, "stale", "python", old)).rejects.toMatchObject({
        code: "document_changed",
      });
      const saved = JSON.parse(
        await new Response(
          await lifecycle.read(
            viewer,
            JSON.parse(
              await commands.language(viewer, id, "python", "python", switched.document.epoch),
            ).id,
          ),
        ).text(),
      );
      expect(saved.question.language).toBe("python");
      expect(saved.document.source).toBe(created.document.source);
      const noChange = JSON.parse(
        await new Response(
          await lifecycle.read(
            viewer,
            JSON.parse(
              await commands.language(viewer, id, "same-language", "python", saved.document.epoch),
            ).id,
          ),
        ).text(),
      );
      expect(noChange.version).toBe(saved.version);
      expect(noChange.document.epoch).toBe(saved.document.epoch);
      const qid = created.questionEpoch;
      await commands.caseVisibility(interviewer, id, "show", "hidden:0", true, qid);
      expect(await new Response(await lifecycle.read(viewer, id)).text()).toContain(
        "revealedCases",
      );
      const sig = {
        className: "Solution",
        methodName: "put",
        parameters: [{ name: "n", type: "int" }],
        returnType: "int",
      };
      const c = { args: [], calls: [{ methodName: "put", args: [1], expected: 1 }] };
      const staged = {
        title: "Stages",
        statementMarkdown: "Implement stages",
        signature: sig,
        odyssey: {
          levels: [
            { title: "First", statementMarkdown: "One", methods: [sig], examples: [c] },
            {
              title: "Second",
              statementMarkdown: "Two",
              methods: [{ ...sig, methodName: "next" }],
              examples: [c],
            },
          ],
        },
        odysseyHiddenCases: [[c], [c]],
      };
      const selected = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await commands.select(host, id, "select", { language: "python", custom: staged }),
            ).id,
          ),
        ).text(),
      );
      expect(selected.questionEpoch).not.toBe(qid);
      expect(selected.document.epoch).not.toBe(saved.document.epoch);
      expect(selected.question.progress.level).toBe(1);
      const longStatus = "wrong\u0000answer" + "x".repeat(140000);
      const submitted = crypto.randomUUID();
      const active = (
        await pool.query(
          "SELECT fixture_id FROM interview_active_runner_inputs WHERE session_id=$1 AND question_epoch=$2",
          [id, selected.questionEpoch],
        )
      ).rows[0];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'submit','','feedback','running','[]')",
          [submitted, viewer.userId, id],
        );
        await client.query(
          "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level) VALUES($1,$2,1,$3,$4,$5,1)",
          [submitted, id, selected.document.epoch, selected.questionEpoch, active.fixture_id],
        );
        await client.query(
          "INSERT INTO execution_jobs(id,submission_id,language,finished) VALUES($1,$2,'python',true)",
          [crypto.randomUUID(), submitted],
        );
        await client.query(
          "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,convert_to('{}','UTF8'))",
          [submitted],
        );
        await client.query(
          "INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) VALUES($1,'sample',0,convert_to('{}','UTF8'))",
          [submitted],
        );
        await client.query(
          "INSERT INTO submission_public_case_statuses(submission_id,channel,ordinal,case_index,status_json,status_hash) SELECT $1,'sample',0,7,v,sha256(v) FROM (SELECT convert_to($2,'UTF8') v) x",
          [submitted, JSON.stringify(longStatus)],
        );
        await client.query(
          "INSERT INTO interview_private_status_headers(submission_id,status_count) VALUES($1,1)",
          [submitted],
        );
        await client.query(
          "INSERT INTO interview_private_case_statuses(submission_id,ordinal,case_id,status_json,status_hash) SELECT $1,0,'level:1:case:0',v,sha256(v) FROM (SELECT convert_to($2,'UTF8') v) x",
          [submitted, JSON.stringify(longStatus)],
        );
        await client.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [
          submitted,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      for (const reader of [host, viewer]) {
        const feedback = JSON.parse(await new Response(await lifecycle.read(reader, id)).text());
        expect(feedback.question.progress.caseStatuses).toEqual([{ index: 7, status: longStatus }]);
      }
      const privateFeedback = JSON.parse(await new Response(await lifecycle.read(host, id)).text());
      expect(privateFeedback.question.privateCaseDetails[0].status).toBe(longStatus);
      await commands.caseVisibility(
        interviewer,
        id,
        "show-staged",
        "level:1:case:0",
        true,
        selected.questionEpoch,
      );
      const disclosed = (await lifecycle.read(viewer, id)).getReader();
      expect((await disclosed.read()).done).toBe(false);
      await commands.caseVisibility(
        interviewer,
        id,
        "hide-staged",
        "level:1:case:0",
        false,
        selected.questionEpoch,
      );
      await expect(disclosed.read()).rejects.toThrow();
      const streamed = (await lifecycle.read(host, id)).getReader();
      expect((await streamed.read()).done).toBe(false);
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [host.userId]);
      await expect(streamed.read()).rejects.toThrow();
      await pool.query("UPDATE users SET disabled=false WHERE id=$1", [host.userId]);
      await expect(
        commands.passStage(interviewer, id, "not-host", selected.questionEpoch, 1),
      ).rejects.toMatchObject({ status: 403 });
      const passed = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(await commands.passStage(host, id, "pass", selected.questionEpoch, 1)).id,
          ),
        ).text(),
      );
      expect(passed.question.progress.level).toBe(2);
      expect(passed.question.privateCaseDetails[0].status).toBe(longStatus);
      expect(passed.document.epoch).toBe(selected.document.epoch);
      expect(passed.questionEpoch).toBe(selected.questionEpoch);
      const replay = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(await commands.passStage(host, id, "pass", selected.questionEpoch, 1)).id,
          ),
        ).text(),
      );
      expect(replay.question.progress.level).toBe(2);
      await expect(
        commands.passStage(host, id, "new-pass", selected.questionEpoch, 1),
      ).rejects.toMatchObject({ code: "stale_version" });
      await expect(
        commands.caseVisibility(host, id, "old-case", "hidden:0", true, qid),
      ).rejects.toMatchObject({ code: "document_changed" });
      const racing = await Promise.allSettled([
        commands.select(host, id, "race-select", {
          problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
          language: "python",
        }),
        commands.passStage(host, id, "race-pass", selected.questionEpoch, 2),
      ]);
      expect(racing[0].status).toBe("fulfilled");
      if (racing[1].status === "rejected")
        expect(racing[1].reason).toMatchObject({ code: "document_changed" });
      expect(
        JSON.parse(await new Response(await lifecycle.read(host, id)).text()).questionEpoch,
      ).not.toBe(selected.questionEpoch);
      const author = questionAuthoring(run, languageRuntime);
      const source = await import("node:fs/promises");
      const privateContent = JSON.parse(
        await source.readFile(
          new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
          "utf8",
        ),
      );
      privateContent.problem.slug = `own-${crypto.randomUUID().slice(0, 8)}`;
      const draft = JSON.parse(
        await author.create(
          { ...host, globalAllowed: false },
          JSON.stringify(privateContent),
          undefined,
        ),
      );
      const privateVersion = JSON.parse(
        await author.publish({ ...host, globalAllowed: false }, draft.id, "1", "private"),
      ).publishedVersionId;
      await expect(
        commands.select(interviewer, id, "other-private", {
          problemVersionId: privateVersion,
          language: "python",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        JSON.parse(
          await new Response(
            await lifecycle.read(
              host,
              JSON.parse(
                await commands.select(host, id, "own-private", {
                  problemVersionId: privateVersion,
                  language: "python",
                }),
              ).id,
            ),
          ).text(),
        ).question.problem.isPrivate,
      ).toBeUndefined();
      const echo = {
        className: "Solution",
        methodName: "echo",
        parameters: [{ name: "text", type: "str" }],
        returnType: "str",
      };
      const nul = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await commands.select(host, id, "nul-select", {
                language: "python",
                custom: {
                  title: "NUL case",
                  statementMarkdown: "Return text",
                  signature: echo,
                  publicCases: [{ args: ["public\u0000value"], expected: "public\u0000value" }],
                  privateCases: [{ args: ["secret\u0000value"], expected: "secret\u0000value" }],
                },
              }),
            ).id,
          ),
        ).text(),
      );
      expect(await new Response(await lifecycle.read(viewer, id)).text()).not.toContain("secret");
      await commands.hints(host, id, "nul-hints", { topics: false });
      const nulSwitch = JSON.parse(
        await new Response(
          await lifecycle.read(
            viewer,
            JSON.parse(
              await commands.language(viewer, id, "nul-language", "java", nul.document.epoch),
            ).id,
          ),
        ).text(),
      );
      expect(JSON.stringify(nulSwitch)).not.toContain("secret");
      const hostAfter = await new Response(await lifecycle.read(host, id)).text();
      expect(hostAfter).toContain("secret\\u0000value");
      const side = await pool.query("SELECT lossless_question FROM interviews WHERE id=$1", [id]);
      expect(side.rows[0].lossless_question).toBeNull();
      await migrate(pool, "auth", resolve("../auth/migrations"));
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES('backfill-operator','Operator','admin') ON CONFLICT(id) DO UPDATE SET role='admin',disabled=false",
      );
      await pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('backfill-subject','Operator','backfill@example.test',true,clock_timestamp(),clock_timestamp()) ON CONFLICT(id) DO UPDATE SET "emailVerified"=true`,
      );
      await pool.query(
        "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://backfill.test','backfill-subject','backfill-operator') ON CONFLICT DO NOTHING",
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','fixture','backfill-operator','bootstrap','backfill-subject','fixture') ON CONFLICT DO NOTHING",
      );
      await pool.query("DELETE FROM interview_public_examples WHERE session_id=$1", [id]);
      const previousUrl = process.env.QUOREM_OPERATOR_DATABASE_URL,
        previousIssuer = process.env.AUTH_ORIGIN;
      process.env.QUOREM_OPERATOR_DATABASE_URL = url!;
      process.env.AUTH_ORIGIN = "https://backfill.test";
      try {
        const op = `backfill-${crypto.randomUUID()}`,
          args = ["--op-id", op, "--reason", "test", "--limit", "8"];
        process.env.AUTH_ORIGIN = "https://invalid.test";
        await expect(backfillInterviewCases([...args, "--dry-run"])).rejects.toThrow(
          "Verified operator binding required",
        );
        process.env.AUTH_ORIGIN = "https://backfill.test";
        const dry = await backfillInterviewCases([...args, "--dry-run"]);
        expect(dry.attempted).toBeGreaterThan(0);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM interview_public_examples WHERE session_id=$1",
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
        const applied = await backfillInterviewCases([...args, "--legacy-drained"]);
        expect(applied.completed).toBeGreaterThan(0);
        expect(applied.complete).toBe(true);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM interview_public_examples WHERE session_id=$1",
              [id],
            )
          ).rows[0].n,
        ).toBeGreaterThan(0);
        expect(
          (
            await pool.query("SELECT count(*)::int AS n FROM access_audit WHERE operation_id=$1", [
              op,
            ])
          ).rows[0].n,
        ).toBe(1);
        expect((await backfillInterviewCases([...args, "--legacy-drained"])).attempted).toBe(0);
        await expect(
          backfillInterviewCases(["--op-id", op, "--reason", "changed", "--legacy-drained"]),
        ).rejects.toThrow("Operation ID already used");
      } finally {
        if (previousUrl === undefined) delete process.env.QUOREM_OPERATOR_DATABASE_URL;
        else process.env.QUOREM_OPERATOR_DATABASE_URL = previousUrl;
        if (previousIssuer === undefined) delete process.env.AUTH_ORIGIN;
        else process.env.AUTH_ORIGIN = previousIssuer;
      }
      await pool.query(
        "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2",
        [id, viewer.userId],
      );
      await expect(
        commands.language(viewer, id, "removed", "java", passed.document.epoch),
      ).rejects.toMatchObject({ status: 404 });
      const held = await pool.connect();
      await held.query("BEGIN");
      await held.query("SELECT id FROM interviews WHERE id=$1 FOR UPDATE", [id]);
      const pending = commands.hints(host, id, "racing-revocation", { topics: true }).then(
        () => null,
        (error) => error,
      );
      let waiting = 0;
      for (let i = 0; i < 40; i++) {
        waiting = Number(
          (
            await pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
            )
          ).rows[0].count,
        );
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThan(0);
      await pool.query(
        "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND feature='interviews.host'",
        [host.userId],
      );
      await held.query("COMMIT");
      held.release();
      expect(await pending).toMatchObject({ status: 403, code: "entitlement_required" });
    } finally {
      await pool.end();
    }
  });
});

it("matches Go operation fingerprints for question controls", async () => {
  const {
    interviewCommandFingerprint,
    interviewQuestionOperationFingerprint,
    interviewCreateFingerprint,
  } = await import("../../../../modules/interviews/question/fingerprint.ts");
  expect(
    await interviewQuestionOperationFingerprint("room:question", {
      hints: { topics: false },
      problemVersionId: "11111111-1111-4111-8111-111111111111",
      language: "python",
    }),
  ).toBe("f862d66975c732e366fa481f1f7b4f62241a5883add78c6ff63882b051bb01af");
  expect(await interviewCommandFingerprint("room:hints", { topics: false, complexity: true })).toBe(
    "15475c3f37c7c0d44050543a3fcc0e26d864854db9e6de3e70f576189faf2feb",
  );
  expect(await interviewCommandFingerprint("room:pass-stage", { Epoch: "epoch", Level: 2 })).toBe(
    "c6348485e6ce30e6ecd19a71544ccc800d02b87aca0163d5ec2f48ffeff3df6e",
  );
  expect(
    await interviewCommandFingerprint("room:case-visibility", {
      ID: "hidden:0",
      Revealed: true,
      Epoch: ["epoch"],
    }),
  ).toBe("fefe3fd85122c31c739a8206509043423ef10bc2d4d4d3788bfecce40356d234");
  expect(
    await interviewCreateFingerprint(
      "<&>",
      { problemVersionId: "11111111-1111-4111-8111-111111111111", language: "python" },
      undefined,
    ),
  ).toBe("c22c27c9658f89a5a2cac11a318d5a5b930db0d812f95663ce07c8c0e1610f5d");
});

it("retains Go raw case spelling for operation replay and rejects mismatched spans", async () => {
  const { fingerprintQuestionInput } = await import("./fingerprint-input.ts");
  const { interviewQuestionOperationFingerprint } =
    await import("../../../../modules/interviews/question/fingerprint.ts");
  const { parseLosslessJson } = await import("@quorem/questions");
  const raw = String.raw`{"language":"python","custom":{"title":"X","statementMarkdown":"Return input","signature":{"className":"Solution","methodName":"echo","parameters":[{"name":"x","type":"str"}],"returnType":"str"},"publicCases":[{"args":["\u0061"],"expected":"\u0061"}],"privateCases":[{"args":["\u0062"],"expected":"\u0062"}]}}`;
  const parsed = parseLosslessJson(raw);
  const input = fingerprintQuestionInput(parsed, raw, false);
  expect(
    await interviewQuestionOperationFingerprint("room:question", input.question, input.marks),
  ).toBe("8c0b00a04fe785aa50563ce2a295be87632bb3ef9cabf9c47002003019a84891");
  const wrapped = `{"title":"Room","question":${raw}}`,
    wrappedInput = fingerprintQuestionInput(parsed, wrapped, true);
  const { interviewCreateFingerprint } =
    await import("../../../../modules/interviews/question/fingerprint.ts");
  expect(
    await interviewCreateFingerprint("Room", wrappedInput.question, undefined, wrappedInput.marks),
  ).toBe("182663a6673c221ea8ef24d62ad0c384a00369ecccf76bab065265901356c1ec");
  expect(() => fingerprintQuestionInput({ language: "java" }, raw, false)).toThrow(
    "Question input mismatch",
  );
});
