import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { interviewQuestionRoutes } from "../../../../modules/interviews/question/routes.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { interviewSnapshotStream } from "./stream.ts";
import { interviewQuestionCommands } from "./commands.ts";
const url = (env as unknown as { INTERVIEW_QUESTIONS_URL: string }).INTERVIEW_QUESTIONS_URL;
describe("workerd interview question commands", () => {
  it("uses actual PostgreSQL identity and authorized HTTP question controls", async () => {
    const parsed = new URL(url);
    expect(["postgres:", "postgresql:"]).toContain(parsed.protocol);
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(parsed.hostname);
    expect(parsed.pathname).toBe("/quorem_hono_interview_questions_test");
    expect(
      [...parsed.searchParams.keys()].some((key) =>
        ["host", "hostaddr", "service"].includes(key.toLowerCase()),
      ),
    ).toBe(false);
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, fn);
    const user = `worker-${crypto.randomUUID()}`;
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
        await tx.execute(
          sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${user},'interviews.host','manual','fixture','fixture','fixture'),(${crypto.randomUUID()}::uuid,${user},'questions.custom','manual','fixture','fixture','fixture')`,
        );
      }),
    );
    const identify = () => run((scope) => developmentIdentity(scope, user));
    const actor = (await identify())!;
    const lifecycle = interviewLifecycle(run, {
      question: preparePublishedInterviewQuestion,
      snapshot: interviewSnapshotStream(run),
    });
    const created = JSON.parse(
      await new Response(
        await lifecycle.read(
          actor,
          JSON.parse(
            await lifecycle.create(actor, "worker-create", {
              title: "Worker",
              question: {
                problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
                language: "python",
              },
            }),
          ).id,
        ),
      ).text(),
    );
    const app = createApp({ allowedOrigins: [], requestId: () => "worker" }).route(
      "/",
      interviewQuestionRoutes({
        questions: interviewQuestionCommands(run),
        identify,
      }),
    );
    const request = (path: string, body: string, key: string) =>
      app.request(`/v1/interviews/${created.id}/${path}`, {
        method: "POST",
        headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
        body,
      });
    const switched = await request(
      "language",
      JSON.stringify({ language: "java", epoch: created.document.epoch }),
      "worker-language",
    );
    expect(switched.status).toBe(200);
    expect(await switched.json()).toEqual({ id: created.id });
    const result = JSON.parse(
      await new Response(await lifecycle.read(actor, created.id)).text(),
    ) as {
      document: { epoch: string };
      question: { language: string };
    };
    expect(result.question.language).toBe("java");
    expect(result.document.epoch).not.toBe(created.document.epoch);
    const stale = await request(
      "language",
      JSON.stringify({ language: "python", epoch: created.document.epoch }),
      "stale",
    );
    expect(stale.status).toBe(409);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    const hint = await request("hints", '{"topics":false}', "worker-hints");
    expect(hint.status).toBe(200);
    expect(await hint.text()).not.toContain("referenceSource");
    const signature = {
        className: "Solution",
        methodName: "put",
        parameters: [{ name: "n", type: "int" }],
        returnType: "int",
      },
      example = { args: [], calls: [{ methodName: "put", args: [1], expected: 1 }] };
    const staged = {
      language: "python",
      custom: {
        title: "Worker stages",
        statementMarkdown: "Implement stages",
        signature,
        odyssey: {
          levels: [
            { title: "One", statementMarkdown: "One", methods: [signature], examples: [example] },
            {
              title: "Two",
              statementMarkdown: "Two",
              methods: [{ ...signature, methodName: "next" }],
              examples: [example],
            },
          ],
        },
        odysseyHiddenCases: [[example], [example]],
      },
    };
    const select = (question: unknown, key: string) =>
      app.request(`/v1/interviews/${created.id}/question`, {
        method: "PUT",
        headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify(question),
      });
    const stageResponse = await select(staged, "stage-select");
    expect(stageResponse.status).toBe(200);
    expect(await stageResponse.json()).toEqual({ id: created.id });
    const stage = JSON.parse(
      await new Response(await lifecycle.read(actor, created.id)).text(),
    ) as { questionEpoch: string };
    const [advance, reselect] = await Promise.all([
      request(
        "pass-stage",
        JSON.stringify({ questionEpoch: stage.questionEpoch, level: 1 }),
        "race-stage",
      ),
      select(
        { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
        "race-select",
      ),
    ]);
    expect([200, 409]).toContain(advance.status);
    expect(reselect.status).toBe(200);
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=${user} AND feature='interviews.host'`,
        );
      }),
    );
    const revoked = await request("hints", '{"topics":true}', "revoked");
    expect(revoked.status).toBe(403);
  });
});
