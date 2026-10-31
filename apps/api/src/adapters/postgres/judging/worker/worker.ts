import { assertRunnerFixture } from "./test-db.ts";
/** @file worker.ts @description Native Worker queue fencing against disposable PostgreSQL. @module judging */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import {
  encodeJob,
  checkpointProvenance,
  decodeJudgeFrame,
  encodeCheckpointFrame,
} from "@quorem/execution";
import { indexRunnerFixture } from "../inputs/fixture.ts";
import { bindJobInputs, fixtureCaseRefs } from "../inputs/bind.ts";
import { postgresExecutionCommands } from "./repository.ts";
import { createRunnerCommandHandler } from "./http.ts";
import { privateRunnerCommands } from "../../../../../../runner/src/queue/http.ts";

it("claims and fences a real attempt through workerd", async () => {
  const url = (env as unknown as { RUNNER_TEST_URL: string }).RUNNER_TEST_URL;
  assertRunnerFixture(url, ["/quorem_hono_runner_test", "/quorem_hono_engine_test"]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const user = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
      await tx.execute(
        sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','',${JSON.stringify({ className: "Solution", methodName: "f", parameters: [], returnType: "int" })}::jsonb,'[]',${JSON.stringify({ wallTimeMs: 2000, memoryBytes: 268435456, outputBytes: 65536, maxProcesses: 16, maxCollectionElements: 10000, maxNestingDepth: 100 })}::jsonb,'')`,
      );
      await tx.execute(
        sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
      );
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
      );
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${user},${workspace}::uuid,'run','','hash','queued','[{"expected":2}]')`,
      );
      await tx.execute(
        sql`INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES(${job}::uuid,${submission}::uuid,'python','python-3.12-v1','quorem-harness-v2')`,
      );
    }),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const raw = JSON.stringify({
        problem: { note: "x".repeat(150000), examples: [{ args: [], expected: 2 }] },
        hiddenCases: [],
      });
      await indexRunnerFixture(tx, { version }, raw);
      const refs = await fixtureCaseRefs(tx, { version }, "example", 0);
      await bindJobInputs(tx, {
        jobId: job,
        owner: { version },
        cases: [{ channel: "public", hash: refs[0].hash }],
        caseCount: 1,
        sampleCount: 0,
        privateDetails: false,
        submitCasesAreSamples: false,
      });
    }),
  );
  try {
    const commands = (signal: AbortSignal) =>
      postgresExecutionCommands(
        <T>(f: (scope: ConnectionScope) => Promise<T>) =>
          withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000, signal }, f),
        { resumable: true, losslessCases: true, losslessResults: true },
      );
    const secret = "fixture-only-worker-private-credential-12345";
    const handler = await createRunnerCommandHandler([
      { secret, scope: "worker-scope", resumable: true, repository: commands },
    ]);
    let dropPromotionAck = false,
      promotionCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init),
        response = await handler(request);
      if (new URL(request.url).pathname.endsWith("/promote")) {
        promotionCalls++;
        if (dropPromotionAck) {
          dropPromotionAck = false;
          await response.body?.cancel();
          throw new Error("fixture lost acknowledgement");
        }
      }
      return response;
    };
    expect(
      (await handler(new Request("https://fixture/internal/runner/claim", { method: "POST" })))
        .status,
    ).toBe(401);
    expect(
      (await handler(new Request("http://not-loopback/internal/runner/claim", { method: "POST" })))
        .status,
    ).toBe(404);
    const claims = privateRunnerCommands({
      origin: "https://fixture",
      secret,
      scope: "worker-scope",
      resumable: true,
      timeoutMs: 5000,
      fetch: fetcher,
    });
    expect((await claims.queueState()).queued).toBeGreaterThanOrEqual(1);
    expect(await claims.confirmQueueEmpty()).toBe(false);
    expect(await claims.nextRunnableDeadline("worker-scope")).toBe(0);
    const claimed = await claims.claimAfterTeardown(true, "worker-scope", null);
    expect(claimed?.jobId).toBe(job);
    expect(await claims.lease(claimed!, true)).toBe(true);
    const manifest = await claims.inputManifest(claimed!);
    expect(manifest.metadata.size).toBeGreaterThan(150000);
    const firstPage = await claims.inputPage(claimed!, "metadata", 0, 0);
    const secondPage = await claims.inputPage(claimed!, "metadata", 0, 65536);
    expect(firstPage.bytes.length).toBe(65536);
    expect(secondPage.bytes.length).toBe(65536);
    expect(firstPage.hash).toBe(manifest.metadata.hash);
    expect((await claims.inputPage(claimed!, "case", 0, 0)).channel).toBe("public");
    await expect(
      claims.inputPage({ ...claimed!, attemptId: crypto.randomUUID() }, "case", 0, 0),
    ).rejects.toThrow();
    const leaseBefore = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{ value: string }>(
              sql`SELECT lease_until::text AS value FROM execution_jobs WHERE id=${job}::uuid`,
            )
          ).rows[0].value,
      ),
    );
    let releaseLock!: () => void, reportLocked!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const lock = run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`SELECT id FROM execution_jobs WHERE id=${job}::uuid FOR UPDATE`);
        reportLocked();
        await hold;
      }),
    );
    await ready;
    const abort = new AbortController();
    const pending = handler(
      new Request("https://fixture/internal/runner/lease", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ job: encodeJob(claimed!), heartbeat: true }),
        signal: abort.signal,
      }),
    );
    setTimeout(() => abort.abort(), 30);
    try {
      expect((await pending).status).toBe(503);
    } finally {
      releaseLock();
      await lock;
    }
    const leaseAfter = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{ value: string }>(
              sql`SELECT lease_until::text AS value FROM execution_jobs WHERE id=${job}::uuid`,
            )
          ).rows[0].value,
      ),
    );
    expect(leaseAfter).toBe(leaseBefore);
    await expect(claims.lease({ ...claimed!, sandboxScope: "other" }, false)).rejects.toThrow(
      "scope",
    );
    const judgeFrame = decodeJudgeFrame(
      '{"status":"executed","actual":123,"stdout":"","stderr":"","line":0}',
    );
    const spec = await claims.load(claimed!);
    const provenance = await checkpointProvenance(
      claimed!,
      spec,
      0,
      claimed!,
      { compilationNanos: 42n },
      judgeFrame,
    );
    const savedFrame = encodeCheckpointFrame(judgeFrame, provenance);
    await claims.saveCheckpoint(claimed!, { ordinal: 0, frame: savedFrame, compilationNanos: 42n });
    const replayed: string[] = [];
    await claims.replayCheckpoint(claimed!, 1, async (_ordinal, frame) => {
      replayed.push(new TextDecoder().decode(frame));
    });
    expect(replayed).toEqual([savedFrame]);
    await claims.beginCompletion(claimed!, {
      submissionId: submission,
      attemptId: claimed!.attemptId,
      engineFailure: true,
      diagnosticsPresent: false,
      publicPresent: false,
      samplePresent: false,
      privatePresent: false,
      publicCount: 0,
      sampleCount: 0,
      privateCount: 0,
    });
    await claims.finishCompletionStream(claimed!, claimed!);
    dropPromotionAck = true;
    await expect(claims.promoteCompletion(claimed!, claimed!)).rejects.toMatchObject({
      outcome: "unknown",
    });
    expect(promotionCalls).toBe(1);
    await claims.promoteCompletion(claimed!, claimed!);
    expect(promotionCalls).toBe(2);
    const row = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{ state: string }>(
              sql`SELECT state FROM submissions WHERE id=${submission}::uuid`,
            )
          ).rows[0],
      ),
    );
    expect(row.state).toBe("queued");
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`UPDATE execution_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=${job}::uuid`,
        );
      }),
    );
    const next = await claims.claimAfterTeardown(true, "worker-scope", null);
    expect(next).not.toBeNull();
    await claims.beginCompletion(next!, {
      submissionId: submission,
      attemptId: next!.attemptId,
      verdict: "wrong_answer",
      engineFailure: false,
      diagnosticsPresent: true,
      publicPresent: true,
      samplePresent: false,
      privatePresent: false,
      publicCount: 1,
      sampleCount: 0,
      privateCount: 0,
    });
    const chunk = async (
      channel: "header" | "public",
      field: "diagnostics" | "actual" | "expected",
      value: string,
    ) =>
      claims.writeCompletionChunk(next!, {
        channel,
        ordinal: 0,
        field,
        chunkOrdinal: 0,
        bytes: new TextEncoder().encode(value),
      });
    const diagnosticBytes = new TextEncoder().encode(
      '[{"message":"n\\u0000l' + "x".repeat(2 * 1024 * 1024) + '"}]',
    );
    for (let offset = 0, part = 0; offset < diagnosticBytes.length; offset += 65536, part++)
      await claims.writeCompletionChunk(next!, {
        channel: "header",
        ordinal: 0,
        field: "diagnostics",
        chunkOrdinal: part,
        bytes: diagnosticBytes.subarray(offset, offset + 65536),
      });
    await claims.sealCompletionDiagnostics(next!);
    await chunk("public", "actual", "123");
    await chunk("public", "expected", "987655");
    for (let offset = 0, part = 0; offset < diagnosticBytes.length; offset += 65536, part++)
      await claims.writeCompletionChunk(next!, {
        channel: "public",
        ordinal: 0,
        field: "diagnostics",
        chunkOrdinal: part,
        bytes: diagnosticBytes.subarray(offset, offset + 65536),
      });
    await claims.sealCompletionFrame(next!, "public", 0, "accepted");
    await claims.finishCompletionStream(next!, next!);
    await claims.promoteCompletion(next!, next!);
    const published = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{
              body: string;
              body_end: string;
              body_size: number;
              diagnostics: string;
              diagnostic_size: number;
            }>(
              sql`SELECT convert_from(substring(c.result_data FROM 1 FOR 64),'UTF8') AS body,convert_from(substring(c.result_data FROM greatest(1,octet_length(c.result_data)-63) FOR 64),'UTF8') AS body_end,octet_length(c.result_data)::int AS body_size,convert_from(substring(h.field_data FROM 1 FOR 64),'UTF8') AS diagnostics,octet_length(h.field_data)::int AS diagnostic_size FROM submission_public_result_cases c JOIN submission_result_header_fields h ON h.submission_id=c.submission_id WHERE c.submission_id=${submission}::uuid`,
            )
          ).rows[0],
      ),
    );
    expect(published.body_end).toContain('"expected":2');
    expect(published.body_end).not.toContain("987655");
    expect(published.body_size).toBeGreaterThan(2 * 1024 * 1024);
    expect(published.diagnostics).toContain("\\u0000");
    expect(published.diagnostic_size).toBeGreaterThan(2 * 1024 * 1024);
  } finally {
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`DELETE FROM execution_jobs WHERE id=${job}::uuid`);
        await tx.execute(sql`DELETE FROM submissions WHERE id=${submission}::uuid`);
        await tx.execute(sql`DELETE FROM workspaces WHERE id=${workspace}::uuid`);
        await tx.execute(sql`DELETE FROM problem_versions WHERE id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problems WHERE id=${problem}::uuid`);
        await tx.execute(sql`DELETE FROM users WHERE id=${user}`);
      }),
    );
  }
}, 30000);
