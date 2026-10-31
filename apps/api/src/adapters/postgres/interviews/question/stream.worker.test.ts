import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { interviewSnapshotStream } from "./stream.ts";
import { createApp } from "../../../../app.ts";
import { interviewLifecycleRoutes } from "../../../../modules/interviews/lifecycle/routes.ts";
const url = (env as unknown as { INTERVIEW_QUESTIONS_URL: string }).INTERVIEW_QUESTIONS_URL;
it("streams large examples and authorized private cases in bounded pages; revocation aborts", async () => {
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, fn);
  const host = `large-host-${crypto.randomUUID()}`,
    candidate = `large-candidate-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name) VALUES(${host},'Host'),(${candidate},'Candidate')`,
      );
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${host},'interviews.host','manual','test','test','test')`,
      );
    }),
  );
  const h = (await run((scope) => developmentIdentity(scope, host)))!,
    c = (await run((scope) => developmentIdentity(scope, candidate)))!,
    read = interviewSnapshotStream(run),
    lifecycle = interviewLifecycle(run, {
      question: preparePublishedInterviewQuestion,
      snapshot: read,
    });
  const ack = JSON.parse(
    await lifecycle.create(h, "create", {
      title: "Large",
      question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
    }),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${ack.id}::uuid,${candidate},'interviewee')`,
      );
      await tx.execute(
        sql`UPDATE interview_public_examples SET examples=convert_to('[{"args":["'||repeat('p',300000)||'"],"expected":null}]','UTF8') WHERE session_id=${ack.id}::uuid AND level=0`,
      );
      await tx.execute(
        sql`UPDATE interview_question_private_cases SET case_data=convert_to('{"args":["'||repeat('s',300000)||'"],"expected":"PRIVATE","referenceSource":"FORBIDDEN"}','UTF8') WHERE session_id=${ack.id}::uuid AND ordinal=0`,
      );
    }),
  );
  const submission = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${candidate},${ack.id}::uuid,'submit','','worker-feedback','running','[]')`,
      );
      await tx.execute(
        sql`INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level) SELECT ${submission}::uuid,i.id,i.document_version,i.document_epoch,i.question_epoch,a.fixture_id,1 FROM interviews i JOIN interview_active_runner_inputs a ON a.session_id=i.id AND a.question_epoch=i.question_epoch WHERE i.id=${ack.id}::uuid`,
      );
      await tx.execute(
        sql`INSERT INTO execution_jobs(id,submission_id,language,finished) VALUES(${crypto.randomUUID()}::uuid,${submission}::uuid,'python',true)`,
      );
      await tx.execute(
        sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${submission}::uuid,convert_to('{}','UTF8'))`,
      );
      await tx.execute(
        sql`INSERT INTO interview_private_status_headers(submission_id,status_count) VALUES(${submission}::uuid,1)`,
      );
      await tx.execute(
        sql`INSERT INTO interview_private_case_statuses(submission_id,ordinal,case_id,status_json,status_hash) SELECT ${submission}::uuid,0,c.case_id,v,sha256(v) FROM interview_question_private_cases c CROSS JOIN (SELECT convert_to(to_json('worker-'||repeat('z',140000))::text,'UTF8') v) raw WHERE c.session_id=${ack.id}::uuid AND c.ordinal=0`,
      );
      await tx.execute(
        sql`UPDATE submissions SET state='completed',result='{}' WHERE id=${submission}::uuid`,
      );
    }),
  );
  async function collect(who: typeof h) {
    const reader = (await read(who, ack.id)).getReader(),
      chunks: Uint8Array[] = [];
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      expect(v.value.length).toBeLessThanOrEqual(65536);
      chunks.push(v.value);
    }
    return await new Response(new Blob(chunks)).text();
  }
  const app = createApp({ allowedOrigins: [], requestId: () => "large" }).route(
    "/",
    interviewLifecycleRoutes({
      lifecycle,
      identify: async () => c,
      allowedOrigins: [],
      trustedPeer: () => "127.0.0.1",
      budget: { allow: async () => true },
    }),
  );
  const http = await app.request(`/v1/interviews/${ack.id}`);
  expect(http.status).toBe(200);
  expect(await http.text()).toContain("p".repeat(300000));
  const publicText = await collect(c);
  expect(publicText).toContain("p".repeat(300000));
  expect(publicText).not.toContain("PRIVATE");
  const staff = await collect(h);
  expect(staff).toContain("s".repeat(300000));
  expect(staff).toContain("PRIVATE");
  expect(staff).toContain("worker-" + "z".repeat(140000));
  expect(publicText).not.toContain("worker-");
  expect(staff).not.toContain("FORBIDDEN");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE interview_members SET role='interviewer' WHERE session_id=${ack.id}::uuid AND user_id=${candidate}`,
      );
    }),
  );
  const demoted = (await read(c, ack.id)).getReader();
  await demoted.read();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE interview_members SET role='interviewee' WHERE session_id=${ack.id}::uuid AND user_id=${candidate}`,
      );
    }),
  );
  await expect(demoted.read()).rejects.toThrow();
  const changed = (await read(c, ack.id)).getReader();
  await changed.read();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`UPDATE interviews SET version=version+1 WHERE id=${ack.id}::uuid`);
    }),
  );
  await expect(changed.read()).rejects.toThrow();
  const reader = (await read(c, ack.id)).getReader();
  await reader.read();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=${ack.id}::uuid AND user_id=${candidate}`,
      );
    }),
  );
  await expect(reader.read()).rejects.toThrow();
});
