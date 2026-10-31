import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshotStream } from "../question/stream.ts";
import { interviewDocumentRoutes } from "../../../../modules/interviews/document/routes.ts";
import { interviewDocumentCommands } from "./commands.ts";
const url = (env as unknown as { INTERVIEW_DOCUMENT_URL: string }).INTERVIEW_DOCUMENT_URL;
it("uses Worker HTTP and PostgreSQL for ordered document replay", async () => {
  const db = new URL(url);
  expect([db.hostname, db.port, db.pathname]).toEqual([
    "127.0.0.1",
    "55468",
    "/quorem_hono_interview_documents_test",
  ]);
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, fn);
  const user = `worker-document-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${user},'interviews.host','manual','test','test','test')`,
      );
    }),
  );
  const identify = () => run((scope) => developmentIdentity(scope, user)),
    who = (await identify())!;
  const lifecycle = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshotStream(run),
  });
  const ack = JSON.parse(
    await lifecycle.create(who, "create", {
      title: "Worker document",
      question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
    }),
  );
  const room = JSON.parse(await new Response(await lifecycle.read(who, ack.id)).text());
  const app = createApp({ allowedOrigins: [], requestId: () => "worker" }).route(
    "/",
    interviewDocumentRoutes({ documents: interviewDocumentCommands(run), identify }),
  );
  const base = `/v1/interviews/${room.id}`,
    batch = {
      epoch: room.document.epoch,
      version: 0,
      updates: [{ clientID: "worker", changes: [[0, "🦊"], room.document.source.length] }],
    };
  const push = (key: string) =>
    app.request(`${base}/updates`, {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(batch).replace("🦊", String.raw`\ud83e\udd8a`),
    });
  const race = await Promise.all([push("worker-a"), push("worker-b")]);
  expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await push(race[0].status === 200 ? "worker-a" : "worker-b")).status).toBe(200);
  const response = await app.request(`${base}/updates?epoch=${batch.epoch}&version=0`);
  expect(response.status).toBe(200);
  expect(((await response.json()) as typeof batch).updates).toEqual(batch.updates);
  expect((await app.request(`${base}/document`)).headers.get("cache-control")).toBe("no-store");
});
