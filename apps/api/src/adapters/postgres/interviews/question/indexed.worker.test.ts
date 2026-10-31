/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { interviewQuestionCommands } from "./commands.ts";
import { interviewSnapshotStream } from "./stream.ts";
const url = (env as unknown as { DATABASE: string }).DATABASE;
it.skipIf(!url)(
  "selects a >128 MiB legacy fixture without materializing it in the Worker",
  async () => {
    const parsed = new URL(url);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55571",
      "/quorem_hono_interview_inputs_test",
    ]);
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 180000 }, fn);
    const host = `large-${crypto.randomUUID()}`,
      candidate = `candidate-${crypto.randomUUID()}`,
      parent = crypto.randomUUID(),
      version = crypto.randomUUID(),
      base = "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      size = 65 * 1024 * 1024;
    const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    };
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 120000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`INSERT INTO users(id,display_name) VALUES(${host},'Large'),(${candidate},'Candidate')`,
        );
        await tx.execute(
          sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${host},'interviews.host','manual','test','test','test')`,
        );
        await tx.execute(
          sql`INSERT INTO problems(id,slug) VALUES(${parent}::uuid,${`large-${parent}`})`,
        );
        await tx.execute(
          sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_public,lossless_fixture) SELECT ${version}::uuid,${parent}::uuid,1,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,NULL,convert_to('{"problem":{"examples":[{"args":["'||repeat('x',${size})||chr(92)||'u0000"],"expected":9007199254740993,"explanation":"public explanation","calls":[{"methodName":"safeCall","args":[],"expected":1,"referenceSource":"NESTED_SECRET"}],"referenceSource":"DO_NOT_LEAK"}]}}','UTF8'),convert_to('{"problem":{"examples":[{"args":["'||repeat('x',${size})||chr(92)||'u0000"],"expected":9007199254740993,"explanation":"public explanation","calls":[{"methodName":"safeCall","args":[],"expected":1,"referenceSource":"NESTED_SECRET"}],"referenceSource":"DO_NOT_LEAK"}]},"hiddenCases":[{"args":["PRIVATE_SECRET'||repeat('y',${size})||'"],"expected":1}]}','UTF8') FROM problem_versions WHERE id=${base}::uuid`,
        );
        await tx.execute(
          sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) SELECT ${version}::uuid,language,starter_source,runtime_revision,harness_revision,reference_source FROM problem_languages WHERE version_id=${base}::uuid`,
        );
        await tx.execute(
          sql`INSERT INTO problem_examples(version_id,ordinal,args,expected,explanation,calls) VALUES(${version}::uuid,0,'["placeholder"]'::jsonb,'9007199254740993'::jsonb,'public explanation','[]'::jsonb)`,
        );
        await tx.execute(
          sql`WITH data AS (SELECT convert_to(jsonb_set(convert_from(b.data,'UTF8')::jsonb,'{id}',to_jsonb(${version}::text))::text,'UTF8') AS value FROM runner_version_inputs r JOIN runner_input_blobs b ON b.hash=r.metadata_hash WHERE r.version_id=${base}::uuid) INSERT INTO runner_input_blobs(hash,data) SELECT sha256(value),value FROM data ON CONFLICT DO NOTHING`,
        );
        await tx.execute(
          sql`INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) SELECT ${version}::uuid,sha256(convert_to(jsonb_set(convert_from(b.data,'UTF8')::jsonb,'{id}',to_jsonb(${version}::text))::text,'UTF8')),sha256(convert_to('legacy fixture','UTF8')) FROM runner_version_inputs r JOIN runner_input_blobs b ON b.hash=r.metadata_hash WHERE r.version_id=${base}::uuid`,
        );
        await tx.execute(
          sql`WITH input AS (SELECT convert_to('{"args":["'||repeat('x',${size})||chr(92)||'u0000"],"calls":[{"args":[],"expected":1,"methodName":"safeCall","referenceSource":"NESTED_SECRET"}],"expected":9007199254740993}','UTF8') AS data) INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT DO NOTHING`,
        );
        await tx.execute(
          sql`INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) SELECT ${version}::uuid,'example',0,0,sha256(convert_to('{"args":["'||repeat('x',${size})||chr(92)||'u0000"],"calls":[{"args":[],"expected":1,"methodName":"safeCall","referenceSource":"NESTED_SECRET"}],"expected":9007199254740993}','UTF8'))`,
        );
        await tx.execute(
          sql`WITH input AS (SELECT convert_to('{"args":["PRIVATE_SECRET'||repeat('y',${size})||'"],"expected":1}','UTF8') AS data) INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT DO NOTHING`,
        );
        await tx.execute(
          sql`INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) SELECT ${version}::uuid,'hidden',0,0,sha256(convert_to('{"args":["PRIVATE_SECRET'||repeat('y',${size})||'"],"expected":1}','UTF8'))`,
        );
        await tx.execute(
          sql`UPDATE runner_version_inputs SET sealed=true WHERE version_id=${version}::uuid`,
        );
        await tx.execute(sql`UPDATE problem_versions SET sealed=true WHERE id=${version}::uuid`);
        await tx.execute(
          sql`UPDATE problems SET current_version_id=${version}::uuid WHERE id=${parent}::uuid`,
        );
      }),
    );
    const legacySize = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ size: number }>(
              sql`SELECT octet_length(lossless_fixture)::int AS size FROM problem_versions WHERE id=${version}::uuid`,
            )
          ).rows[0].size,
      ),
    );
    expect(legacySize).toBeGreaterThan(128 * 1024 * 1024);
    const read = interviewSnapshotStream(run),
      lifecycle = interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: read,
      });
    const created = JSON.parse(
      await lifecycle.create(actor, "large-create", {
        title: "Large",
        question: { problemVersionId: version, language: "python" },
      }),
    );
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${created.id}::uuid,${candidate},'interviewee')`,
        );
      }),
    );
    const readerActor = { ...actor, userId: candidate, displayName: candidate };
    const commands = interviewQuestionCommands(run);
    await commands.select(actor, created.id, "large-select", {
      problemVersionId: version,
      language: "python",
    });
    await commands.select(actor, created.id, "large-select", {
      problemVersionId: version,
      language: "python",
    });
    const info = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ doc: string; epoch: string; size: number }>(
              sql`SELECT document_epoch::text AS doc,question_epoch::text AS epoch,octet_length((SELECT examples FROM interview_public_examples WHERE session_id=i.id AND question_epoch=i.question_epoch AND level=0))::int AS size FROM interviews i WHERE id=${created.id}::uuid`,
            )
          ).rows[0],
      ),
    );
    expect(info.size).toBeGreaterThan(64 * 1024 * 1024);
    await commands.language(actor, created.id, "large-language", "java", info.doc);
    const stream = (await read(readerActor, created.id)).getReader(),
      decoder = new TextDecoder();
    let length = 0,
      tail = "",
      sawNul = false,
      sawNumber = false,
      sawExplanation = false,
      sawCall = false,
      leaked = false;
    for (;;) {
      const part = await stream.read();
      if (part.done) break;
      expect(part.value.length).toBeLessThanOrEqual(65536);
      length += part.value.length;
      const text = tail + decoder.decode(part.value, { stream: true });
      sawNul ||= text.includes("\\u0000");
      sawNumber ||= text.includes("9007199254740993");
      sawExplanation ||= text.includes("public explanation");
      sawCall ||= text.includes("safeCall");
      leaked ||=
        text.includes("PRIVATE_SECRET") ||
        text.includes("DO_NOT_LEAK") ||
        text.includes("NESTED_SECRET");
      tail = text.slice(-128);
    }
    expect(length).toBeGreaterThan(64 * 1024 * 1024);
    expect([sawNul, sawNumber, sawExplanation, sawCall, leaked]).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    const mapping = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT 1 FROM interview_active_runner_inputs a JOIN runner_snapshot_inputs r ON r.session_id=a.session_id AND r.fixture_id=a.fixture_id AND r.sealed WHERE a.session_id=${created.id}::uuid AND a.question_epoch=${info.epoch}::uuid`,
            )
          ).rows.length,
      ),
    );
    expect(mapping).toBe(1);
  },
  240000,
);
