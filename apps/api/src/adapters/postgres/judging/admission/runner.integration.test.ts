/** @file runner.integration.test.ts @description Admitted work through the actual TypeScript runner. @module judging */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { claimNext } from "../../../../../../runner/src/queue/claim.ts";
import { fileURLToPath } from "node:url";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { createApp } from "../../../../app.ts";
import { admissionRoutes } from "../../../../modules/judging/admission/routes.ts";
import { submissionRoutes } from "../../../../modules/judging/results/routes.ts";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import { submissionSnapshots } from "../results/repository.ts";
import { postgresExecutionCommands } from "../worker/repository.ts";
import { workspaceRepository } from "../../workspace/repository.ts";
import { indexRunnerFixture } from "../inputs/fixture.ts";
import { createVerificationSourceHandler } from "../worker/verification-http.ts";
import { httpResultVerifier, type ResultVerifier } from "../worker/verification-client.ts";
import { createVerificationService } from "../../../../../../runner/src/verification/service.ts";
import { createRunnerCommandHandler } from "../worker/http.ts";
import { dockerSandbox } from "../../../../../../runner/src/sandbox/docker.ts";
import { privateRunnerCommands } from "../../../../../../runner/src/queue/http.ts";
import { drainer } from "../../../../../../runner/src/drains/drain.ts";
import { checkpointedEngine } from "../../../../../../runner/src/orchestration/engine.ts";
import {
  controlPolling,
  queueControl,
} from "../../../../../../runner/src/orchestration/control.ts";
const url = process.env.QUOREM_ENGINE_TEST_DATABASE_URL,
  socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
if (url) {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/quorem_hono_engine_test" ||
    ["host", "hostaddr", "service"].some((key) => parsed.searchParams.has(key))
  )
    throw new Error("Disposable engine database required");
}
describe.skipIf(!url || !socket)("admission through TypeScript runner", () => {
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 12000 }, fn);
  const owner = `runner-e2e-${crypto.randomUUID()}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID();
  const principal: LocalPrincipal = {
    kind: "local",
    userId: owner,
    displayName: owner,
    admin: false,
    emailVerified: true,
    sessionId: "fixture",
    strongUntil: 0,
  };
  const identify = async (request: Request) =>
    request.headers.get("x-fixture-other") ? { ...principal, userId: "missing-user" } : principal;
  const app = createApp({ allowedOrigins: ["https://fixture.test"], requestId: () => "fixture" });
  app.route(
    "/",
    admissionRoutes({
      identify,
      guestExecution: true,
      receipts: prearmReceipts(run, "execution"),
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: { send: async () => {} },
      shard: 43,
      commit: postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true }),
    }),
  );
  app.route("/", submissionRoutes({ identify, snapshots: submissionSnapshots(run) }));
  let stateRoot: string,
    verificationServer: Server,
    verificationPublicKey: CryptoKey,
    verifier: ResultVerifier;
  beforeAll(async () => {
    stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-admission-runner-")));
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [owner]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    await pool.query(
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','',$3::jsonb,'[]',$4::jsonb,'')",
      [
        version,
        problem,
        JSON.stringify({
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type: "int" }],
          returnType: "int",
        }),
        JSON.stringify({
          wallTimeMs: 2000,
          memoryBytes: 268435456,
          outputBytes: 65536,
          maxProcesses: 16,
          maxCollectionElements: 10000,
          maxNestingDepth: 100,
        }),
      ],
    );
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
      [version],
    );
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'typescript','','typescript-5.9.3-node-22.21.1-v1','quorem-typescript-v1','')",
      [version],
    );
    await pool.query(
      "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,'[1]','2')",
      [version],
    );
    await pool.query(
      "INSERT INTO problem_test_cases(version_id,ordinal,args,expected) VALUES($1,0,'[3]','4')",
      [version],
    );
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        await indexRunnerFixture(
          tx,
          { version },
          JSON.stringify({
            problem: {
              id: version,
              signature: {
                className: "Solution",
                methodName: "f",
                parameters: [{ name: "x", type: "int" }],
                returnType: "int",
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
              examples: [{ args: [1], expected: 2 }],
            },
            hiddenCases: [{ args: [3], expected: 4 }],
          }),
        );
      }),
    );
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    verificationPublicKey = keys.publicKey;
    const sourceCredential = new Uint8Array(32).fill(3),
      serviceCredential = new Uint8Array(32).fill(4),
      sourceHandler = createVerificationSourceHandler(run, sourceCredential);
    verificationServer = createServer(
      createVerificationService({
        sourceOrigin: "https://fixture",
        sourceCredential,
        serviceCredential,
        signingKey: keys.privateKey,
        timeoutMs: 10000,
        fetch: async (input, init) => sourceHandler(new Request(input, init)),
      }),
    );
    verificationServer.listen(0, "127.0.0.1");
    await once(verificationServer, "listening");
    const verifierAddress = verificationServer.address();
    if (!verifierAddress || typeof verifierAddress === "string")
      throw new Error("Verifier listener unavailable");
    verifier = httpResultVerifier({
      origin: `http://127.0.0.1:${verifierAddress.port}`,
      credential: serviceCredential,
      timeoutMs: 10000,
    });
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
      [workspace, owner, version],
    );
  }, 30000);
  afterAll(async () => {
    await pool.query(
      "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=$1)",
      [owner],
    );
    await pool.query("DELETE FROM cancellation_idempotency WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM execution_idempotency WHERE owner_id=$1", [owner]);
    await pool.query(
      "DELETE FROM execution_attempt_usage WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [owner],
    );
    await pool.query(
      "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [owner],
    );
    await pool.query("DELETE FROM submissions WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM workspaces WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    verificationServer.close();
    await once(verificationServer, "close");
    await pool.end();
    await rm(stateRoot, { recursive: true, force: true });
  });
  it("runs a real admitted Python job through private commands and Docker", async () => {
    const response = await app.request("https://fixture.test/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "runner-e2e" },
      body: JSON.stringify({
        workspaceId: workspace,
        kind: "submit",
        source: "class Solution:\n def f(self,x): return x+1",
      }),
    });
    expect(response.status).toBe(202);
    const id = (await response.json()).id as string;
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "admission-runner",
      cleanupMs: 10000,
    });
    const secret = "fixture-only-private-runner-secret-123456";
    const handler = await createRunnerCommandHandler([
      {
        secret,
        scope: sandbox.scope,
        resumable: true,
        inputProtocol: "manifest-v1",
        repository: () =>
          postgresExecutionCommands(
            run,
            {
              inputProtocol: "manifest-v1",
              resumable: true,
              losslessCases: true,
              losslessResults: true,
            },
            { verifier, verificationPublicKey },
          ),
      },
    ]);
    const repository = privateRunnerCommands({
      origin: "https://fixture",
      secret,
      scope: sandbox.scope,
      resumable: true,
      timeoutMs: 5000,
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const drain = drainer({
      repository,
      sandbox,
      cancellations: controlPolling(25),
      queue: queueControl(repository, sandbox.scope, 25),
      engine: checkpointedEngine(repository, sandbox),
      slots: 1,
      resumable: true,
      graceMs: 100,
      claimWindowMs: 10000,
    });
    expect((await drain.drain(AbortSignal.timeout(30000))).complete).toBe(true);
    const row = await pool.query("SELECT state FROM submissions WHERE id=$1", [id]);
    expect(row.rows[0].state).toBe("completed");
    const projected = await app.request(`https://fixture.test/v1/submissions/${id}`);
    expect(projected.status).toBe(200);
    const body = await projected.json();
    expect(body.verdict).toBe("accepted");
    expect(body.hiddenCases).toEqual([{ index: 0, status: "accepted" }]);
    expect(JSON.stringify(body)).not.toMatch(/jobId|attemptId|sandboxScope/);
    expect(
      (
        await app.request(`https://fixture.test/v1/submissions/${id}`, {
          headers: { "x-fixture-other": "1" },
        })
      ).status,
    ).toBe(404);
  }, 40000);
  it("publishes independently verified syntax, runtime, time and output failures", async () => {
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "admission-runner-errors",
      cleanupMs: 10000,
    });
    const secret = "fixture-only-private-runner-errors-123456";
    const handler = await createRunnerCommandHandler([
      {
        secret,
        scope: sandbox.scope,
        resumable: true,
        inputProtocol: "manifest-v1",
        repository: () =>
          postgresExecutionCommands(
            run,
            {
              inputProtocol: "manifest-v1",
              resumable: true,
              losslessCases: true,
              losslessResults: true,
            },
            { verifier, verificationPublicKey },
          ),
      },
    ]);
    const repository = privateRunnerCommands({
      origin: "https://fixture",
      secret,
      scope: sandbox.scope,
      resumable: true,
      timeoutMs: 5000,
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const drain = drainer({
      repository,
      sandbox,
      cancellations: controlPolling(25),
      queue: queueControl(repository, sandbox.scope, 25),
      engine: checkpointedEngine(repository, sandbox),
      slots: 1,
      resumable: true,
      graceMs: 100,
      claimWindowMs: 10000,
    });
    for (const [name, source, expected] of [
      ["syntax", "not valid !", "syntax_error"],
      [
        "runtime",
        "class Solution:\n def f(self,x): raise RuntimeError('fixture')",
        "runtime_error",
      ],
      ["time", "class Solution:\n def f(self,x):\n  while True: pass", "time_limit"],
      ["nul", "class Solution:\n def f(self,x):\n  print('a\\x00b')\n  return x+1", "accepted"],
      [
        "output",
        "class Solution:\n def f(self,x):\n  print('x'*100000)\n  return 2",
        "output_limit",
      ],
    ] as const) {
      await pool.query(
        "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
        [owner],
      );
      const response = await app.request("https://fixture.test/v1/submissions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `runner-error-${name}` },
        body: JSON.stringify({ workspaceId: workspace, kind: "run", source }),
      });
      expect(response.status).toBe(202);
      const id = (await response.json()).id as string;
      expect((await drain.drain(AbortSignal.timeout(30000))).complete).toBe(true);
      const result = await app.request(`https://fixture.test/v1/submissions/${id}`);
      expect(result.status).toBe(200);
      const value = await result.json();
      expect(value.verdict).toBe(expected);
      expect(value.publicCases[0].status).toBe(expected);
      if (name === "nul") expect(value.publicCases[0].stdout).toBe("a\u0000b\n");
    }
    const typescriptWorkspace = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'typescript')",
      [typescriptWorkspace, owner, version],
    );
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [owner],
    );
    const compile = await app.request("https://fixture.test/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "runner-error-compile" },
      body: JSON.stringify({
        workspaceId: typescriptWorkspace,
        kind: "run",
        source: "class Solution { f(x: number): number { return ; !!! } }",
      }),
    });
    expect(compile.status).toBe(202);
    const compiledId = (await compile.json()).id as string;
    expect((await drain.drain(AbortSignal.timeout(30000))).complete).toBe(true);
    const compiledResult = await app.request(`https://fixture.test/v1/submissions/${compiledId}`);
    expect(compiledResult.status).toBe(200);
    const compiledValue = await compiledResult.json();
    expect(compiledValue.verdict).toBe("syntax_error");
    expect(compiledValue.publicCases[0].status).toBe("syntax_error");
  }, 120000);
  it("verifies unordered SQL results and independently reports output type mismatch", async () => {
    const sqlProblem = crypto.randomUUID(),
      sqlVersion = crypto.randomUUID(),
      sqlWorkspace = crypto.randomUUID();
    const sqlConfig = {
      dialect: "postgresql",
      outputOrder: "unordered",
      tables: [{ name: "items", columns: [{ name: "id", type: "integer" }] }],
      output: [{ name: "id", type: "integer" }],
    };
    const signature = { className: "Solution", methodName: "f", parameters: [], returnType: "int" };
    const limits = {
      wallTimeMs: 2000,
      memoryBytes: 268435456,
      outputBytes: 65536,
      maxProcesses: 16,
      maxCollectionElements: 10000,
      maxNestingDepth: 100,
    };
    const sample = {
      args: [{ tables: [{ name: "items", rows: [[1], [2]] }] }],
      expected: { rows: [[1], [2]] },
    };
    try {
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [sqlProblem, sqlProblem]);
      await pool.query(
        "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config) VALUES($1,$2,1,'SQL','easy','',$3::jsonb,'[]',$4::jsonb,'',$5::jsonb)",
        [
          sqlVersion,
          sqlProblem,
          JSON.stringify(signature),
          JSON.stringify(limits),
          JSON.stringify(sqlConfig),
        ],
      );
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'postgresql','','postgresql-17.6-v1','quorem-postgresql-v1','')",
        [sqlVersion],
      );
      await pool.query(
        "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,$2::jsonb,$3::jsonb)",
        [sqlVersion, JSON.stringify(sample.args), JSON.stringify(sample.expected)],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'postgresql')",
        [sqlWorkspace, owner, sqlVersion],
      );
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
          indexRunnerFixture(
            tx,
            { version: sqlVersion },
            JSON.stringify({
              problem: {
                id: sqlVersion,
                signature,
                constraints: [],
                limits,
                sql: sqlConfig,
                examples: [sample],
              },
              hiddenCases: [],
            }),
          ),
        ),
      );
      const sandbox = await dockerSandbox({
        socket: socket!,
        stateRoot,
        namespace: "admission-runner-sql",
        cleanupMs: 10000,
      });
      const secret = "fixture-only-private-runner-sql-12345678";
      const handler = await createRunnerCommandHandler([
        {
          secret,
          scope: sandbox.scope,
          resumable: true,
          inputProtocol: "manifest-v1",
          repository: () =>
            postgresExecutionCommands(
              run,
              {
                inputProtocol: "manifest-v1",
                resumable: true,
                losslessCases: true,
                losslessResults: true,
              },
              { verifier, verificationPublicKey },
            ),
        },
      ]);
      const repository = privateRunnerCommands({
        origin: "https://fixture",
        secret,
        scope: sandbox.scope,
        resumable: true,
        timeoutMs: 5000,
        fetch: async (input, init) => handler(new Request(input, init)),
      });
      const drain = drainer({
        repository,
        sandbox,
        cancellations: controlPolling(25),
        queue: queueControl(repository, sandbox.scope, 25),
        engine: checkpointedEngine(repository, sandbox),
        slots: 1,
        resumable: true,
        graceMs: 100,
        claimWindowMs: 10000,
      });
      for (const [name, source, expected] of [
        ["unordered", "SELECT id FROM items ORDER BY id DESC", "accepted"],
        ["type", "SELECT id::bigint AS id FROM items ORDER BY id DESC", "wrong_answer"],
        ["invalid", "SELECT 1 AS id FROM generate_series(1,10001)", "invalid_output"],
      ] as const) {
        await pool.query(
          "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
          [owner],
        );
        const response = await app.request("https://fixture.test/v1/submissions", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": `runner-sql-${name}` },
          body: JSON.stringify({ workspaceId: sqlWorkspace, kind: "run", source }),
        });
        expect(response.status).toBe(202);
        const id = (await response.json()).id as string;
        expect((await drain.drain(AbortSignal.timeout(30000))).complete).toBe(true);
        const result = await app.request(`https://fixture.test/v1/submissions/${id}`);
        expect(result.status).toBe(200);
        const value = await result.json();
        expect(value.verdict).toBe(expected);
        if (name === "type")
          expect(value.publicCases[0].diagnostics).toContainEqual({
            message: "Output column types do not match the SQL schema.",
          });
        if (name === "invalid")
          expect(value.publicCases[0].diagnostics).toContainEqual({
            message: "The query returned an invalid or unsupported result.",
          });
      }
    } finally {
      await pool.query(
        "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.workspace_id=$1)",
        [sqlWorkspace],
      );
      await pool.query(
        "DELETE FROM execution_idempotency WHERE owner_id=$1 AND key LIKE 'runner-sql-%'",
        [owner],
      );
      await pool.query(
        "DELETE FROM execution_attempt_usage WHERE submission_id IN (SELECT id FROM submissions WHERE workspace_id=$1)",
        [sqlWorkspace],
      );
      await pool.query(
        "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE workspace_id=$1)",
        [sqlWorkspace],
      );
      await pool.query("DELETE FROM submissions WHERE workspace_id=$1", [sqlWorkspace]);
      await pool.query("DELETE FROM workspaces WHERE id=$1", [sqlWorkspace]);
      await pool.query("DELETE FROM problem_versions WHERE id=$1", [sqlVersion]);
      await pool.query("DELETE FROM problems WHERE id=$1", [sqlProblem]);
    }
  }, 90000);
  it("persists verified failure before the next sandbox case completes", async () => {
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [owner],
    );
    const response = await app.request("https://fixture.test/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "runner-early-failure" },
      body: JSON.stringify({
        workspaceId: workspace,
        kind: "submit",
        source: "class Solution:\n def f(self,x):\n  if x==3: return 0\n  while True: pass",
      }),
    });
    expect(response.status).toBe(202);
    const id = (await response.json()).id as string;
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "admission-runner-early",
      cleanupMs: 10000,
    });
    const secret = "fixture-only-private-runner-early-123456";
    const handler = await createRunnerCommandHandler([
      {
        secret,
        scope: sandbox.scope,
        resumable: true,
        inputProtocol: "manifest-v1",
        repository: () =>
          postgresExecutionCommands(
            run,
            {
              inputProtocol: "manifest-v1",
              resumable: true,
              losslessCases: true,
              losslessResults: true,
            },
            { verifier, verificationPublicKey },
          ),
      },
    ]);
    const repository = privateRunnerCommands({
      origin: "https://fixture",
      secret,
      scope: sandbox.scope,
      resumable: true,
      timeoutMs: 5000,
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const drain = drainer({
      repository,
      sandbox,
      cancellations: controlPolling(25),
      queue: queueControl(repository, sandbox.scope, 25),
      engine: checkpointedEngine(repository, sandbox),
      slots: 1,
      resumable: true,
      graceMs: 100,
      claimWindowMs: 10000,
    });
    const running = drain.drain(AbortSignal.timeout(30000));
    let seen = false;
    for (let i = 0; i < 250; i++) {
      const row = (
        await pool.query(
          "SELECT v.status,j.finished FROM execution_jobs j JOIN execution_verified_cases v ON v.job_id=j.id AND v.attempt_id=j.attempt_id WHERE j.submission_id=$1 AND v.ordinal=0",
          [id],
        )
      ).rows[0];
      if (row) {
        expect(row.status).toBe("wrong_answer");
        expect(row.finished).toBe(false);
        seen = true;
        break;
      }
      await sleep(20);
    }
    expect(seen).toBe(true);
    expect((await running).complete).toBe(true);
    const result = await app.request(`https://fixture.test/v1/submissions/${id}`);
    expect((await result.json()).verdict).toBe("wrong_answer");
  }, 40000);
  it("retains verified solo Odyssey feedback after promotion and clears it on reset", async () => {
    const p = crypto.randomUUID(),
      v = crypto.randomUUID(),
      w = crypto.randomUUID();
    const signature = {
      className: "Solution",
      methodName: "f",
      parameters: [{ name: "x", type: "int" }],
      returnType: "int",
    };
    const limits = {
      wallTimeMs: 2000,
      memoryBytes: 268435456,
      outputBytes: 65536,
      maxProcesses: 16,
      maxCollectionElements: 10000,
      maxNestingDepth: 100,
    };
    const sample = { args: [], calls: [{ methodName: "f", args: [1], expected: 2 }] },
      hidden = { args: [], calls: [{ methodName: "f", args: [3], expected: 4 }] };
    const odyssey = {
      levels: [
        { title: "One", statementMarkdown: "One", methods: [signature], examples: [sample] },
      ],
    };
    try {
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [p, p]);
      await pool.query(
        "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey) VALUES($1,$2,1,'Odyssey','easy','',$3::jsonb,'[]',$4::jsonb,'',$5::jsonb)",
        [v, p, JSON.stringify(signature), JSON.stringify(limits), JSON.stringify(odyssey)],
      );
      await pool.query("UPDATE problems SET current_version_id=$1 WHERE id=$2", [v, p]);
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
        [v],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [w, owner, v],
      );
      await pool.query(
        "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,1)",
        [w, v],
      );
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
          indexRunnerFixture(
            tx,
            { version: v },
            JSON.stringify({
              problem: { id: v, signature, constraints: [], limits, odyssey },
              odysseyHiddenCases: [[hidden]],
            }),
          ),
        ),
      );
      await pool.query(
        "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
        [owner],
      );
      const response = await app.request("https://fixture.test/v1/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "runner-odyssey-feedback",
        },
        body: JSON.stringify({
          workspaceId: w,
          level: 1,
          kind: "submit",
          source: "class Solution:\n def f(self,x): return x+1",
        }),
      });
      expect(response.status, await response.clone().text()).toBe(202);
      const sandbox = await dockerSandbox({
        socket: socket!,
        stateRoot,
        namespace: "admission-runner-odyssey",
        cleanupMs: 10000,
      });
      const secret = "fixture-only-private-runner-odyssey-12345";
      const handler = await createRunnerCommandHandler([
        {
          secret,
          scope: sandbox.scope,
          resumable: true,
          inputProtocol: "manifest-v1",
          repository: () =>
            postgresExecutionCommands(
              run,
              {
                inputProtocol: "manifest-v1",
                resumable: true,
                losslessCases: true,
                losslessResults: true,
              },
              { verifier, verificationPublicKey },
            ),
        },
      ]);
      const repository = privateRunnerCommands({
        origin: "https://fixture",
        secret,
        scope: sandbox.scope,
        resumable: true,
        timeoutMs: 5000,
        fetch: async (input, init) => handler(new Request(input, init)),
      });
      const drain = drainer({
        repository,
        sandbox,
        cancellations: controlPolling(25),
        queue: queueControl(repository, sandbox.scope, 25),
        engine: checkpointedEngine(repository, sandbox),
        slots: 1,
        resumable: true,
        graceMs: 100,
        claimWindowMs: 10000,
      });
      expect((await drain.drain(AbortSignal.timeout(30000))).complete).toBe(true);
      const workspaces = workspaceRepository(run),
        progress = JSON.parse(await new Response(await workspaces.odyssey(principal, w)).text());
      expect(progress.caseStatuses).toEqual([{ index: 0, status: "accepted" }]);
      const reset = JSON.parse(await workspaces.reset(principal, w));
      expect(reset.caseStatuses).toBeUndefined();
    } finally {
      await pool.query(
        "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.workspace_id=$1)",
        [w],
      );
      await pool.query(
        "DELETE FROM execution_idempotency WHERE owner_id=$1 AND key='runner-odyssey-feedback'",
        [owner],
      );
      await pool.query(
        "DELETE FROM execution_attempt_usage WHERE submission_id IN (SELECT id FROM submissions WHERE workspace_id=$1)",
        [w],
      );
      await pool.query(
        "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE workspace_id=$1)",
        [w],
      );
      await pool.query("DELETE FROM submissions WHERE workspace_id=$1", [w]);
      await pool.query("DELETE FROM odyssey_progress WHERE scope_id=$1", [w]);
      await pool.query("DELETE FROM workspaces WHERE id=$1", [w]);
      await pool.query("UPDATE problems SET current_version_id=NULL WHERE id=$1", [p]);
      await pool.query("DELETE FROM problem_versions WHERE id=$1", [v]);
      await pool.query("DELETE FROM problems WHERE id=$1", [p]);
    }
  }, 60000);
  it("cancels an actually running Docker case and reclaims only after teardown", async () => {
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [owner],
    );
    const response = await app.request("https://fixture.test/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "runner-cancel" },
      body: JSON.stringify({
        workspaceId: workspace,
        kind: "run",
        source: "class Solution:\n def f(self,x):\n  while True: pass",
      }),
    });
    expect(response.status).toBe(202);
    const id = (await response.json()).id as string;
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "admission-runner",
      cleanupMs: 10000,
    });
    const secret = "fixture-only-private-runner-secret-123456";
    const handler = await createRunnerCommandHandler([
      {
        secret,
        scope: sandbox.scope,
        resumable: true,
        inputProtocol: "manifest-v1",
        repository: () =>
          postgresExecutionCommands(
            run,
            {
              inputProtocol: "manifest-v1",
              resumable: true,
              losslessCases: true,
              losslessResults: true,
            },
            { verifier, verificationPublicKey },
          ),
      },
    ]);
    const repository = privateRunnerCommands({
      origin: "https://fixture",
      secret,
      scope: sandbox.scope,
      resumable: true,
      timeoutMs: 5000,
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const drain = drainer({
      repository,
      sandbox,
      cancellations: controlPolling(25),
      queue: queueControl(repository, sandbox.scope, 25),
      engine: checkpointedEngine(repository, sandbox),
      slots: 1,
      resumable: true,
      graceMs: 100,
      claimWindowMs: 10000,
    });
    const execution = drain.drain(AbortSignal.timeout(30000));
    let attempt = "",
      running = "";
    for (let i = 0; i < 100; i++) {
      attempt =
        (
          await pool.query(
            "SELECT j.attempt_id::text AS attempt FROM execution_jobs j WHERE j.submission_id=$1",
            [id],
          )
        ).rows[0].attempt ?? "";
      if (attempt)
        running = execFileSync(
          "docker",
          [
            "--config",
            "/nonexistent",
            "--host",
            `unix://${socket}`,
            "ps",
            "-q",
            "--filter",
            `label=quorem.attempt=${attempt}`,
          ],
          { encoding: "utf8" },
        ).trim();
      if (running) break;
      await sleep(30);
    }
    expect(running).not.toBe("");
    const cancelled = await app.request(`https://fixture.test/v1/submissions/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "runner-cancel-request" },
      body: "{}",
    });
    expect(cancelled.status).toBe(200);
    await expect(execution).rejects.toThrow();
    expect(
      execFileSync(
        "docker",
        [
          "--config",
          "/nonexistent",
          "--host",
          `unix://${socket}`,
          "ps",
          "-aq",
          "--filter",
          `label=quorem.attempt=${attempt}`,
        ],
        { encoding: "utf8" },
      ).trim(),
    ).toBe("");
    await pool.query(
      "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE submission_id=$1",
      [id],
    );
    expect(
      await claimNext(repository, sandbox, { resumable: true, scope: sandbox.scope }),
    ).toBeNull();
    expect(
      (await pool.query("SELECT state FROM submissions WHERE id=$1", [id])).rows[0].state,
    ).toBe("cancelled");
  }, 40000);
});
