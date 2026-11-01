/** @file runner.integration.test.ts @description Admitted work through the actual TypeScript runner. @module judging */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { claimNext } from "../../../../../../runner/src/queue/claim.ts";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
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
import { remoteSandbox } from "../../../../../../runner/src/sandbox/remote.ts";
import { accessFetch } from "@quorem/execution/transport/access";
import { localFenceRoot } from "../../../../../../runner/src/sandbox/fence.ts";
import { privateRunnerCommands } from "../../../../../../runner/src/queue/http.ts";
import { drainer } from "../../../../../../runner/src/drains/drain.ts";
import { checkpointedEngine } from "../../../../../../runner/src/orchestration/engine.ts";
import {
  controlPolling,
  queueControl,
} from "../../../../../../runner/src/orchestration/control.ts";
const url = process.env.QUOREM_ENGINE_TEST_DATABASE_URL,
  socket = process.env.QUOREM_TEST_DOCKER_SOCKET,
  remote = process.env.QUOREM_REMOTE_VALIDATION === "true";
if (url) {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !==
      (remote ? "/quorem_hono_remote_validation_test" : "/quorem_hono_engine_test") ||
    !!parsed.hash ||
    [...parsed.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  )
    throw new Error("Disposable engine database required");
}
describe.skipIf(!url || (!socket && !remote))("admission through TypeScript runner", () => {
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
  it(
    "runs an admitted job through separate runner and verifier executables",
    async () => {
      const work = await realpath(await mkdtemp(join(tmpdir(), "quorem-executable-e2e-")));
      const caseOrigin = process.env.QUOREM_CASE_ORIGIN ?? "";
      const caseAccess =
        process.env.QUOREM_CASE_ACCESS_CLIENT_ID && process.env.QUOREM_CASE_ACCESS_CLIENT_SECRET
          ? {
              id: process.env.QUOREM_CASE_ACCESS_CLIENT_ID,
              secret: process.env.QUOREM_CASE_ACCESS_CLIENT_SECRET,
            }
          : undefined;
      const sandbox = remote
        ? remoteSandbox({
            origin: caseOrigin,
            secret: process.env.QUOREM_CASE_SECRET!,
            namespaceId: process.env.QUOREM_CASE_NAMESPACE_ID!,
            ownerPublicKey: await readFile(process.env.QUOREM_CASE_OWNER_PUBLIC_KEY_FILE!, "utf8"),
            cleanupMs: 30000,
            fetch: accessFetch(caseOrigin, caseAccess),
          })
        : await dockerSandbox({
            socket: socket!,
            stateRoot: work,
            namespace: "executable-e2e",
            cleanupMs: 10000,
          });
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const keyFile = join(work, "verifier.pem");
      await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), {
        mode: 0o600,
      });
      const publicCrypto = await crypto.subtle.importKey(
        "spki",
        publicKey.export({ type: "spki", format: "der" }),
        "Ed25519",
        false,
        ["verify"],
      );
      const sourceKey = new Uint8Array(32).fill(21),
        serviceKey = new Uint8Array(32).fill(22);
      const commandSecret = "fixture-command-secret-123456789012345",
        drainSecret = "fixture-drain-secret-12345678901234567";
      const source = createVerificationSourceHandler(run, sourceKey);
      let commands: Awaited<ReturnType<typeof createRunnerCommandHandler>> | undefined;
      const api = createServer(async (req, res) => {
        try {
          const parts: Uint8Array[] = [];
          for await (const part of req) parts.push(part as Buffer);
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers))
            if (typeof value === "string") headers.set(name, value);
          const request = new Request(`http://127.0.0.1${req.url}`, {
            method: req.method,
            headers,
            body: new Uint8Array(Buffer.concat(parts)),
          });
          const response = req.url?.startsWith("/internal/verification/")
            ? await source(request)
            : commands
              ? await commands(request)
              : new Response(null, { status: 503 });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(500).end();
        }
      });
      api.listen(0, "127.0.0.1");
      await once(api, "listening");
      const addr = api.address();
      if (!addr || typeof addr === "string") throw new Error("API address");
      const apiOrigin = `http://127.0.0.1:${addr.port}`;
      const freePort = async () => {
        const server = createNetServer();
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("port");
        const result = address.port;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return result;
      };
      const verifierPort = await freePort(),
        runnerPort = await freePort();
      const waitHealth = async (origin: string, child: ChildProcess) => {
        for (let i = 0; i < 100; i++) {
          if (child.exitCode !== null) throw new Error("Service exited");
          try {
            if ((await fetch(`${origin}/health`)).ok) return;
          } catch {}
          await sleep(50);
        }
        throw new Error("Service unavailable");
      };
      const stop = async (child: ChildProcess | undefined) => {
        if (!child || child.exitCode !== null) return;
        const ended = once(child, "exit");
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
        try {
          const [code] = await ended;
          expect(code).toBe(0);
        } finally {
          clearTimeout(timer);
        }
      };
      const containerMode = process.env.QUOREM_CONTAINER_FIXTURE === "1";
      let serviceDiagnostics = "";
      const service = (kind: "runner" | "verifier", script: string, env: NodeJS.ProcessEnv) => {
        if (!containerMode) {
          const child = spawn(process.execPath, [script], {
            stdio: ["ignore", "ignore", "pipe"],
            env: { ...process.env, ...env },
          });
          child.stderr?.on("data", (data) => {
            serviceDiagnostics = (serviceDiagnostics + String(data)).slice(-4096);
          });
          return child;
        }
        const volume = process.env.QUOREM_CONTAINER_FENCE_VOLUME;
        const namespace = process.env.HOSTNAME;
        if (!volume || !namespace || !work.startsWith("/quorem-36b/"))
          throw new Error(
            "Container fixture requires its shared fence volume and network namespace",
          );
        const args = [
          "run",
          "--rm",
          "--network",
          `container:${namespace}`,
          "--group-add",
          process.env.QUOREM_CONTAINER_SOCKET_GID ?? "0",
          "--mount",
          `type=volume,source=${volume},destination=/quorem-36b`,
        ];
        if (kind === "runner")
          args.push(
            "--mount",
            "type=bind,source=/var/run/docker.sock,destination=/var/run/docker.sock",
          );
        for (const [key, value] of Object.entries(env))
          if (value !== undefined) args.push("-e", `${key}=${value}`);
        args.push(`quorem-hono-${kind}:36b`);
        return spawn("docker", args, { stdio: "ignore" });
      };
      if (containerMode) {
        const daemon = execFileSync(
          "docker",
          ["--host", `unix://${socket!}`, "info", "--format", "{{.ID}}"],
          { encoding: "utf8" },
        ).trim();
        const root = await localFenceRoot(work, "executable-e2e", daemon);
        expect(root.scope).toBe(sandbox.scope);
        const fence = { sandboxScope: root.scope, attemptId: "shared-fence-probe" };
        const lease = await root.acquire(fence, AbortSignal.timeout(5000));
        const prefix = createHash("sha256").update(root.scope).digest("hex").slice(0, 16);
        await utimes(
          join(work, `attempt-${prefix}-${fence.attemptId}.lock`),
          new Date(0),
          new Date(0),
        );
        const probe = `import {localFenceRoot} from './apps/runner/src/sandbox/fence.ts'; const root=await localFenceRoot(process.env.ROOT,'executable-e2e',process.env.DAEMON); if(root.scope!==process.env.SCOPE) process.exit(3); try { const lease=await root.acquire({sandboxScope:root.scope,attemptId:'shared-fence-probe'},AbortSignal.timeout(1000)); await lease.release(); process.exit(4); } catch(e) { if(e.name!=='AbortError' || e.cause?.name!=='TimeoutError') throw e; }`;
        try {
          execFileSync(
            "docker",
            [
              "run",
              "--rm",
              "--mount",
              `type=volume,source=${process.env.QUOREM_CONTAINER_FENCE_VOLUME},destination=/quorem-36b`,
              "-e",
              `ROOT=${work}`,
              "-e",
              `DAEMON=${daemon}`,
              "-e",
              `SCOPE=${root.scope}`,
              "--entrypoint",
              "node",
              "quorem-hono-runner:36b",
              "--input-type=module",
              "-e",
              probe,
            ],
            { stdio: "pipe", timeout: 10000 },
          );
        } finally {
          await lease.release();
        }
      }
      let verifierProcess: ChildProcess | undefined,
        runnerProcess: ChildProcess | undefined,
        competingRunner: ChildProcess | undefined;
      try {
        verifierProcess = service(
          "verifier",
          fileURLToPath(
            new URL("../../../../../../runner/src/runtime/verifier.ts", import.meta.url),
          ),
          {
            QUOREM_VERIFIER_LISTEN: `127.0.0.1:${verifierPort}`,
            QUOREM_VERIFICATION_SOURCE_ORIGIN: apiOrigin,
            QUOREM_VERIFICATION_SOURCE_KEY: Buffer.from(sourceKey).toString("hex"),
            QUOREM_VERIFICATION_SERVICE_KEY: Buffer.from(serviceKey).toString("hex"),
            QUOREM_VERIFICATION_SIGNING_KEY_FILE: keyFile,
          },
        );
        const verifierOrigin = `http://127.0.0.1:${verifierPort}`;
        await waitHealth(verifierOrigin, verifierProcess);
        const externalVerifier = httpResultVerifier({
          origin: verifierOrigin,
          credential: serviceKey,
          timeoutMs: 10000,
        });
        commands = await createRunnerCommandHandler([
          {
            secret: commandSecret,
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
                { verifier: externalVerifier, verificationPublicKey: publicCrypto },
              ),
          },
        ]);
        runnerProcess = service(
          "runner",
          fileURLToPath(new URL("../../../../../../runner/src/runtime/runner.ts", import.meta.url)),
          {
            QUOREM_RUNNER_MODE: "http",
            QUOREM_SANDBOX_PROVIDER: remote ? "remote" : "docker",
            QUOREM_RUNNER_LISTEN: `127.0.0.1:${runnerPort}`,
            QUOREM_RUNNER_COMMAND_ORIGIN: apiOrigin,
            QUOREM_RUNNER_COMMAND_SECRET: commandSecret,
            QUOREM_RUNNER_DRAIN_SECRET: drainSecret,
            QUOREM_DOCKER_SOCKET: socket!,
            QUOREM_DOCKER_FENCE_ROOT: work,
            QUOREM_DOCKER_NAMESPACE: "executable-e2e",
          },
        );
        const runnerOrigin = `http://127.0.0.1:${runnerPort}`;
        await waitHealth(runnerOrigin, runnerProcess);
        const admitted = await app.request("https://fixture.test/v1/submissions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "runner-executable-e2e",
          },
          body: JSON.stringify({
            workspaceId: workspace,
            kind: "submit",
            source: "class Solution:\n def f(self,x): return x+1",
          }),
        });
        expect(admitted.status).toBe(202);
        const id = (await admitted.json()).id as string;
        // Hosted cold start includes a 60s readiness budget plus execution and teardown.
        const drainTimeoutMs = remote ? 180000 : 60000;
        const drain = await fetch(`${runnerOrigin}/internal/drain`, {
          method: "POST",
          headers: { authorization: `Bearer ${drainSecret}` },
          signal: AbortSignal.timeout(drainTimeoutMs),
        });
        const requireDrained = async (response: Response, scenario: string) => {
          // A bounded drain can yield while a cancelled attempt's lease expires.
          for (let continuation = 0; response.status === 202 && continuation < 3; continuation++) {
            await response.body?.cancel();
            response = await fetch(`${runnerOrigin}/internal/drain`, {
              method: "POST",
              headers: { authorization: `Bearer ${drainSecret}` },
              signal: AbortSignal.timeout(drainTimeoutMs),
            });
          }
          if (response.status !== 200)
            throw new Error(
              `Hosted ${scenario} drain HTTP ${response.status}: ${await response.text()} ${serviceDiagnostics}`,
            );
        };
        await requireDrained(drain, "accepted");
        const result = await app.request(`https://fixture.test/v1/submissions/${id}`);
        expect(result.status).toBe(200);
        expect((await result.json()).verdict).toBe("accepted");
        if (remote) {
          for (const [name, source, verdict] of [
            ["wrong", "class Solution:\n def f(self,x): return 0", "wrong_answer"],
            ["syntax", "not valid !", "syntax_error"],
            [
              "runtime",
              "class Solution:\n def f(self,x): raise RuntimeError('fixture')",
              "runtime_error",
            ],
            ["timeout", "class Solution:\n def f(self,x):\n  while True: pass", "time_limit"],
          ]) {
            await pool.query(
              "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
              [owner],
            );
            const submitted = await app.request("https://fixture.test/v1/submissions", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": `remote-${name}` },
              body: JSON.stringify({ workspaceId: workspace, kind: "run", source }),
            });
            expect(submitted.status).toBe(202);
            const submittedId = (await submitted.json()).id as string;
            await requireDrained(
              await fetch(`${runnerOrigin}/internal/drain`, {
                method: "POST",
                headers: { authorization: `Bearer ${drainSecret}` },
                signal: AbortSignal.timeout(drainTimeoutMs),
              }),
              name,
            );
            const response = await app.request(
              `https://fixture.test/v1/submissions/${submittedId}`,
            );
            expect(response.status).toBe(200);
            expect((await response.json()).verdict).toBe(verdict);
          }
          const tsWorkspace = crypto.randomUUID();
          await pool.query(
            "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'typescript')",
            [tsWorkspace, owner, version],
          );
          await pool.query(
            "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
            [owner],
          );
          const compile = await app.request("https://fixture.test/v1/submissions", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": "remote-compile" },
            body: JSON.stringify({
              workspaceId: tsWorkspace,
              kind: "run",
              source: "class Solution { f(x: number): number { return ; !!! } }",
            }),
          });
          expect(compile.status).toBe(202);
          const compileId = (await compile.json()).id as string;
          await requireDrained(
            await fetch(`${runnerOrigin}/internal/drain`, {
              method: "POST",
              headers: { authorization: `Bearer ${drainSecret}` },
              signal: AbortSignal.timeout(drainTimeoutMs),
            }),
            "compile",
          );
          expect(
            (await (await app.request(`https://fixture.test/v1/submissions/${compileId}`)).json())
              .verdict,
          ).toBe("syntax_error");
          await pool.query(
            "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
            [owner],
          );
          const slow = await app.request("https://fixture.test/v1/submissions", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": "remote-cancel" },
            body: JSON.stringify({
              workspaceId: workspace,
              kind: "run",
              source: "import time\nclass Solution:\n def f(self,x):\n  time.sleep(30)\n  return x",
            }),
          });
          expect(slow.status).toBe(202);
          const slowId = (await slow.json()).id as string;
          const pending = fetch(`${runnerOrigin}/internal/drain`, {
            method: "POST",
            headers: { authorization: `Bearer ${drainSecret}` },
            signal: AbortSignal.timeout(drainTimeoutMs),
          });
          const ownerKey = await readFile(process.env.QUOREM_CASE_OWNER_PUBLIC_KEY_FILE!, "utf8");
          const probeKey = await crypto.subtle.importKey(
            "spki",
            createPublicKey(ownerKey).export({ type: "spki", format: "der" }),
            "Ed25519",
            false,
            ["verify"],
          );
          const { verifyCaseProbe } = await import("../../../../../../../deploy/case-proof.js");
          const probeFetch = accessFetch(caseOrigin, caseAccess) ?? fetch;
          const probe = async (attempt: string, scope: string) => {
            const nonce = crypto.randomUUID();
            const response = await probeFetch(new URL(`/internal/case/${attempt}`, caseOrigin), {
              headers: {
                authorization: `Bearer ${process.env.QUOREM_CASE_SECRET!}`,
                "x-quorem-case-probe": "lifecycle",
                "x-quorem-owner-nonce": nonce,
                "x-quorem-owner-scope": scope,
              },
              redirect: "error",
              signal: AbortSignal.timeout(10000),
            });
            return verifyCaseProbe(response, {
              publicKey: probeKey,
              kind: "lifecycle",
              scope,
              attempt,
              nonce,
              expectedNamespace: process.env.QUOREM_CASE_NAMESPACE_ID!,
            });
          };
          let activeAttempt: { attempt: string; scope: string } | undefined;
          for (let i = 0; i < 600; i++) {
            const row = (
              await pool.query(
                "SELECT attempt_id::text AS attempt,sandbox_scope AS scope FROM execution_jobs WHERE submission_id=$1",
                [slowId],
              )
            ).rows[0];
            if (row?.attempt && row.scope === sandbox.scope) {
              const state = await probe(row.attempt, row.scope);
              if (state.active === true && state.running === true) {
                activeAttempt = { attempt: row.attempt, scope: row.scope };
                break;
              }
            }
            await sleep(100);
          }
          expect(activeAttempt).toBeDefined();
          expect(
            (
              await app.request(`https://fixture.test/v1/submissions/${slowId}/cancel`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": "remote-cancel-request",
                },
                body: "{}",
              })
            ).status,
          ).toBe(200);
          await requireDrained(await pending, "cancellation");
          expect(
            (await pool.query("SELECT state FROM submissions WHERE id=$1", [slowId])).rows[0].state,
          ).toBe("cancelled");
          const stopped = await probe(activeAttempt!.attempt, activeAttempt!.scope);
          expect(stopped.active).toBe(false);
          expect(stopped.running).toBe(false);
          await sandbox.teardownAttempt({
            attemptId: activeAttempt!.attempt,
            sandboxScope: activeAttempt!.scope,
          });
          const foreignKey = generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "pem" })
            .toString();
          const namespace = process.env.QUOREM_CASE_NAMESPACE_ID!;
          for (const [namespaceId, ownerPublicKey] of [
            [namespace === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64), ownerKey],
            [namespace, foreignKey],
          ]) {
            const wrong = remoteSandbox({
              origin: caseOrigin,
              secret: process.env.QUOREM_CASE_SECRET!,
              namespaceId,
              ownerPublicKey,
              cleanupMs: 30000,
              fetch: accessFetch(caseOrigin, caseAccess),
            });
            await expect(
              wrong.teardownAttempt({ sandboxScope: wrong.scope, attemptId: crypto.randomUUID() }),
            ).rejects.toThrow(/unconfirmed/i);
          }
          return;
        }
        const slow = await app.request("https://fixture.test/v1/submissions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "runner-executable-shutdown",
          },
          body: JSON.stringify({
            workspaceId: workspace,
            kind: "run",
            source: "import time\nclass Solution:\n def f(self,x):\n  time.sleep(30)\n  return x",
          }),
        });
        expect(slow.status).toBe(202);
        const slowId = (await slow.json()).id as string;
        const pending = fetch(`${runnerOrigin}/internal/drain`, {
          method: "POST",
          headers: { authorization: `Bearer ${drainSecret}` },
        }).then(
          () => undefined,
          () => undefined,
        );
        const label = createHash("sha256").update(sandbox.scope).digest("hex");
        const containers = (all = false) =>
          execFileSync(
            "docker",
            [
              "--config",
              "/nonexistent",
              "--host",
              `unix://${socket!}`,
              "ps",
              all ? "-aq" : "-q",
              "--filter",
              `label=quorem.scope=${label}`,
            ],
            { encoding: "utf8" },
          ).trim();
        let active = false;
        for (let i = 0; i < 200; i++) {
          if (containers()) {
            active = true;
            break;
          }
          await sleep(25);
        }
        expect(active).toBe(true);
        if (containerMode) {
          const competingPort = await freePort();
          competingRunner = service("runner", "", {
            QUOREM_RUNNER_MODE: "http",
            QUOREM_SANDBOX_PROVIDER: "docker",
            QUOREM_RUNNER_LISTEN: `127.0.0.1:${competingPort}`,
            QUOREM_RUNNER_COMMAND_ORIGIN: apiOrigin,
            QUOREM_RUNNER_COMMAND_SECRET: commandSecret,
            QUOREM_RUNNER_DRAIN_SECRET: drainSecret,
            QUOREM_DOCKER_SOCKET: socket!,
            QUOREM_DOCKER_FENCE_ROOT: work,
            QUOREM_DOCKER_NAMESPACE: "executable-e2e",
          });
          await waitHealth(`http://127.0.0.1:${competingPort}`, competingRunner);
          expect(containers()).not.toBe("");
          expect(
            (await pool.query("SELECT state FROM submissions WHERE id=$1", [slowId])).rows[0].state,
          ).toBe("running");
          await stop(competingRunner);
          competingRunner = undefined;
        }
        await stop(runnerProcess);
        runnerProcess = undefined;
        await pending;
        expect(containers(true)).toBe("");
        const row = (await pool.query("SELECT state FROM submissions WHERE id=$1", [slowId]))
          .rows[0];
        expect(["queued", "running"]).toContain(row.state);
        await pool.query(
          "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT id FROM execution_jobs WHERE submission_id=$1)",
          [slowId],
        );
        await pool.query("DELETE FROM execution_attempt_usage WHERE submission_id=$1", [slowId]);
        await pool.query("DELETE FROM execution_jobs WHERE submission_id=$1", [slowId]);
        await pool.query(
          "DELETE FROM execution_idempotency WHERE owner_id=$1 AND key='runner-executable-shutdown'",
          [owner],
        );
        await pool.query("DELETE FROM submissions WHERE id=$1", [slowId]);
      } finally {
        await stop(competingRunner);
        await stop(runnerProcess);
        await stop(verifierProcess);
        await new Promise<void>((resolve) => api.close(() => resolve()));
        await rm(work, { recursive: true, force: true });
      }
    },
    remote ? 900000 : 90000,
  );
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
  it("promotes a resumed interview Run without replacing prior Submit feedback", async () => {
    const { seedCatalog } = await import("../../../../cli/seed.ts");
    const { interviewLifecycle } = await import("../../interviews/lifecycle/repository.ts");
    const { preparePublishedInterviewQuestion } =
      await import("../../interviews/question/prepare.ts");
    const { interviewSnapshotStream } = await import("../../interviews/question/stream.ts");
    const { interviewDocumentCommands } = await import("../../interviews/document/commands.ts");
    const { interviewQuestionCommands } = await import("../../interviews/question/commands.ts");
    const { postgresInterviewAdmission } = await import("../../interviews/execution/repository.ts");
    const { parseInterviewExecution } =
      await import("../../../../modules/interviews/execution/command.ts");
    const { sourceHash } = await import("@quorem/execution");
    await seedCatalog(pool, false);
    const interviewOwner = `interview-host-${crypto.randomUUID()}`;
    const host: LocalPrincipal = {
      ...principal,
      userId: interviewOwner,
      displayName: interviewOwner,
    };
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host')", [interviewOwner]);
    await pool.query(
      "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','interview-run-fixture','fixture','fixture')",
      [crypto.randomUUID(), interviewOwner],
    );
    const candidate = `interview-candidate-${crypto.randomUUID()}`;
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Candidate')", [candidate]);
    const interview = interviewLifecycle(run, {
      question: preparePublishedInterviewQuestion,
      snapshot: interviewSnapshotStream(run),
    });
    const questions = interviewQuestionCommands(run),
      docs = interviewDocumentCommands(run);
    const created = JSON.parse(
      await interview.create(host, "run-regression-create", {
        title: "Run regression",
        question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
      }),
    ) as { id: string };
    await pool.query(
      "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewee')",
      [created.id, candidate],
    );
    const candidateActor: LocalPrincipal = { ...host, userId: candidate, displayName: candidate };
    const snapshot = async () =>
      JSON.parse(await new Response(await interview.read(host, created.id)).text());
    const initial = await snapshot();
    const source =
      "# UTF-16 🧪 café\nclass Solution:\n def runWidths(self, values):\n  result=[]\n  for value in values:\n   if not result or value != previous: result.append(1)\n   else: result[-1]+=1\n   previous=value\n  return result\n";
    await docs.push(host, created.id, "run-regression-edit", {
      epoch: initial.document.epoch,
      version: 0,
      updates: [
        { clientID: "fixture", changes: [[initial.document.source.length, ...source.split("\n")]] },
      ],
    });
    const current = await snapshot();
    const admit = postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true });
    const submit = async (kind: "run" | "submit", key: string) => {
      await pool.query(
        "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
        [interviewOwner],
      );
      const receiptId = crypto.randomUUID(),
        jobId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES($1,'execution',0,clock_timestamp()+interval '1 minute')",
        [receiptId],
      );
      const command = await parseInterviewExecution(
        JSON.stringify({
          kind,
          level: 1,
          questionEpoch: current.questionEpoch,
          documentEpoch: current.document.epoch,
          sourceHash: await sourceHash(source),
        }),
        key,
      );
      return {
        ...(await admit(host, created.id, key, command, { receiptId, jobId, shard: 0 })),
        jobId,
      };
    };
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "interview-run-regression",
      cleanupMs: 10000,
    });
    const secret = "fixture-only-interview-runner-secret-123456";
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
    const drain = (sliceMs: number) =>
      drainer({
        repository,
        sandbox,
        cancellations: controlPolling(25),
        queue: queueControl(repository, sandbox.scope, 25),
        engine: checkpointedEngine(repository, sandbox, sliceMs),
        slots: 1,
        resumable: true,
        graceMs: 100,
        claimWindowMs: 30000,
      });
    const submitted = await submit("submit", "interview-submit");
    expect((await drain(50000).drain(AbortSignal.timeout(60000))).complete).toBe(true);
    const snapshots = submissionSnapshots(run);
    const staffResult = await new Response(
      await snapshots.interview(host, created.id, submitted.id),
    ).json();
    const candidateResult = await new Response(
      await snapshots.interview(candidateActor, created.id, submitted.id),
    ).json();
    expect(staffResult.verdict).toBe("accepted");
    expect(staffResult.privateCaseResults.length).toBeGreaterThan(0);
    expect(candidateResult.privateCaseResults).toBeUndefined();
    const caseId = (
      await pool.query(
        "SELECT case_id FROM interview_question_private_cases WHERE session_id=$1 AND question_epoch=$2 ORDER BY ordinal LIMIT 1",
        [created.id, current.questionEpoch],
      )
    ).rows[0].case_id;
    await questions.caseVisibility(host, created.id, "reveal", caseId, true, current.questionEpoch);
    expect(
      (
        await new Response(
          await snapshots.interview(candidateActor, created.id, submitted.id),
        ).json()
      ).privateCaseResults.length,
    ).toBeGreaterThan(0);
    const before = await snapshot();
    expect(before.latestSubmissionId).toBe(submitted.id);
    const latestSubmit = async () =>
      (
        await pool.query(
          "SELECT s.id::text FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE e.session_id=$1 AND s.kind='submit' AND s.state='completed' ORDER BY s.admitted_at DESC,s.id DESC LIMIT 1",
          [created.id],
        )
      ).rows[0].id;
    expect(await latestSubmit()).toBe(submitted.id);
    const executed = await submit("run", "interview-run");
    expect((await drain(1).drain(AbortSignal.timeout(60000))).complete).toBe(true);
    const result = await new Response(
      await snapshots.interview(host, created.id, executed.id),
    ).json();
    expect(result.verdict).toBe("accepted");
    expect(result.publicCases.length).toBeGreaterThan(0);
    expect(result.privateCaseResults).toBeUndefined();
    const row = (
      await pool.query(
        "SELECT s.state,(SELECT count(DISTINCT v.attempt_id)::int FROM execution_verified_cases v WHERE v.job_id=j.id) AS verified_attempts,(SELECT count(*)::int FROM interview_private_result_cases p WHERE p.submission_id=s.id) AS private_count FROM submissions s JOIN execution_jobs j ON j.submission_id=s.id WHERE s.id=$1",
        [executed.id],
      )
    ).rows[0];
    expect(row.state).toBe("completed");
    expect(row.verified_attempts).toBeGreaterThan(1);
    expect(row.private_count).toBe(0);
    expect(await latestSubmit()).toBe(submitted.id);
    const after = await snapshot();
    expect(after.latestSubmissionId).toBe(executed.id);
    expect(after.question.privateCaseDetails).toEqual(before.question.privateCaseDetails);
    expect(
      (
        await new Response(
          await snapshots.interview(candidateActor, created.id, submitted.id),
        ).json()
      ).privateCaseResults.length,
    ).toBeGreaterThan(0);
  }, 120000);
});
