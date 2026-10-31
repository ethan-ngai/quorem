import { assertRuntimeTestDatabase } from "./test-database.ts";
import { createHmac, createHash } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { startNodeRuntime } from "../node.ts";
import { dockerSandbox } from "../../../../runner/src/sandbox/docker.ts";
import { privateRunnerCommands } from "../../../../runner/src/queue/http.ts";
import { claimNext } from "../../../../runner/src/queue/claim.ts";
import { executeAndStage } from "../../../../runner/src/engine/execute.ts";
import { finishAfterTeardown } from "../../../../runner/src/queue/finish.ts";
import { createVerificationService } from "../../../../runner/src/verification/service.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL,
  docker = process.env.QUOREM_TEST_DOCKER_SOCKET;
it.skipIf(!url || !docker).each(["node", "worker"] as const)(
  "%s admits only after a durable wake and completes Docker through the signed HTTP verifier",
  async (mode) => {
    assertRuntimeTestDatabase(url!);
    let queueReady = false,
      queueCalls = 0;
    const queue = createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (part) => parts.push(Buffer.from(part)));
      req.once("end", () => {
        queueCalls++;
        res.writeHead(queueReady ? 200 : 503, { "content-type": "application/x-amz-json-1.0" });
        if (!queueReady) return res.end("{}");
        const body = JSON.parse(Buffer.concat(parts).toString()) as { MessageBody: string };
        return res.end(
          JSON.stringify({
            MessageId: "fixture",
            MD5OfMessageBody: createHash("md5").update(body.MessageBody).digest("hex"),
          }),
        );
      });
    });
    let verifierHandler: RequestListener = (_req, res) => {
      res.writeHead(503).end();
    };
    const verifier = createServer((req, res) => verifierHandler(req, res));
    queue.listen(0, "127.0.0.1");
    verifier.listen(0, "127.0.0.1");
    await Promise.all([once(queue, "listening"), once(verifier, "listening")]);
    const queuePort = (queue.address() as AddressInfo).port,
      verifierPort = (verifier.address() as AddressInfo).port;
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString(
      "base64",
    );
    const prior = {
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_ENDPOINT_URL_SQS: process.env.AWS_ENDPOINT_URL_SQS,
    };
    Object.assign(process.env, {
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "fixture",
      AWS_SECRET_ACCESS_KEY: "fixture",
      AWS_ENDPOINT_URL_SQS: `http://127.0.0.1:${queuePort}`,
    });
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-35a-sandbox-")));
    const sandbox = await dockerSandbox({
      socket: docker!,
      stateRoot,
      namespace: `runtime-${crypto.randomUUID()}`,
      cleanupMs: 10000,
    });
    const authSecret = "local-runtime-fixture-secret-32-characters",
      runnerSecret = "runner-fixture-credential-32-bytes-unique",
      source = "11".repeat(32),
      service = "22".repeat(32);
    const env = {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://127.0.0.1:8765",
      AUTH_DATABASE_URL: url!,
      DATABASE_URL: url!,
      QUOREM_DATABASE_LISTEN_URL: url!,
      BETTER_AUTH_SECRET: authSecret,
      AUTH_INTERNAL_SECRET: "local-test-internal",
      QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MATCH_INVITE_KEY: "ab".repeat(32),
      EXECUTION_WAKE_PROVIDER: "sqs",
      EXECUTION_NODE_QUEUE_MODE: "disabled",
      SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
      SQS_LOCAL_ENDPOINT: `http://127.0.0.1:${queuePort}`,
      PORT: "0",
      IDENTITY_MODE: "managed",
      RUNNER_PEERS: JSON.stringify([
        { secret: runnerSecret, scope: sandbox.scope, resumable: true },
      ]),
      VERIFICATION_SOURCE_CREDENTIAL: source,
      VERIFICATION_SERVICE_CREDENTIAL: service,
      VERIFICATION_ACCESS_MODE: "none",
      VERIFICATION_SERVICE_ORIGIN: `http://127.0.0.1:${verifierPort}`,
      VERIFICATION_PUBLIC_KEY: publicKey,
    };
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const user = `e2e-${crypto.randomUUID()}`,
      session = crypto.randomUUID(),
      token = crypto.randomUUID();
    await pool.query("DELETE FROM quorem_auth.rate_limit");
    await pool.query(
      'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,NOW(),NOW())',
      [user, `${user}@example.test`],
    );
    await pool.query(
      'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
      [session, token, user],
    );
    let closeRuntime: () => Promise<void>;
    let base: string;
    if (mode === "node") {
      const runtime = await startNodeRuntime(env);
      if (!runtime.server.listening) await once(runtime.server, "listening");
      base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
      closeRuntime = () => runtime.close();
    } else {
      const reservation = createServer();
      reservation.listen(0, "127.0.0.1");
      await once(reservation, "listening");
      const port = (reservation.address() as AddressInfo).port;
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      base = `http://127.0.0.1:${port}`;
      const args = [
        "exec",
        "wrangler",
        "dev",
        "--local",
        "--port",
        String(port),
        "--config",
        "src/runtime/composition/wrangler.test.jsonc",
        "--persist-to",
        join(stateRoot, "wrangler"),
        "--log-level",
        "error",
      ];
      for (const key of [
        "RUNNER_PEERS",
        "VERIFICATION_SOURCE_CREDENTIAL",
        "VERIFICATION_SERVICE_CREDENTIAL",
        "VERIFICATION_ACCESS_MODE",
        "VERIFICATION_SERVICE_ORIGIN",
        "VERIFICATION_PUBLIC_KEY",
      ] as const)
        args.push("--var", `${key}:${env[key]}`);
      const child = spawn("vp", args, {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: url!.replace(
            "postgres://engai@",
            "postgres://engai:fixture-only@",
          ),
        },
      });
      closeRuntime = async () => {
        if (child.exitCode === null) {
          try {
            process.kill(-child.pid!, "SIGTERM");
          } catch {}
          await once(child, "exit");
        }
      };
      let ready = false;
      for (let n = 0; n < 300; n++) {
        if (child.exitCode !== null) break;
        try {
          if ((await fetch(`${base}/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) {
        await closeRuntime();
        throw new Error("Local workerd failed to start");
      }
    }
    try {
      verifierHandler = createVerificationService({
        sourceOrigin: base,
        sourceCredential: Buffer.from(source, "hex"),
        serviceCredential: Buffer.from(service, "hex"),
        signingKey: keys.privateKey,
        timeoutMs: 30000,
      });
      const signature = createHmac("sha256", authSecret).update(token).digest("base64"),
        cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
      const auth = await fetch(`${base}/api/auth/token`, {
        headers: { cookie, origin: "http://127.0.0.1:5173" },
      });
      expect(auth.status).toBe(200);
      const bearer = ((await auth.json()) as { token: string }).token,
        headers = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
      const workspaceResponse = await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
          language: "python",
        }),
      });
      expect(workspaceResponse.status).toBe(201);
      const workspace = ((await workspaceResponse.json()) as { id: string }).id;
      const sourceCode =
        "class Solution:\n def runWidths(self, values):\n  result=[]\n  for value in values:\n   if not result or value != previous: result.append(1)\n   else: result[-1]+=1\n   previous=value\n  return result\n";
      const body = JSON.stringify({ workspaceId: workspace, kind: "run", source: sourceCode });
      if (mode === "node") {
        const failure = await fetch(`${base}/v1/submissions`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": "provider-failure" },
          body,
        });
        expect(failure.status).toBe(503);
        expect(
          Number(
            (
              await pool.query("SELECT count(*) AS n FROM submissions WHERE workspace_id=$1", [
                workspace,
              ])
            ).rows[0].n,
          ),
        ).toBe(0);
        queueReady = true;
      }
      const admitted = await fetch(`${base}/v1/submissions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": "success" },
        body,
      });
      expect(
        admitted.status,
        `response=${await admitted.clone().text()} queueCalls=${queueCalls}`,
      ).toBe(202);
      if (mode === "node") expect(queueCalls).toBeGreaterThan(1);
      const submission = ((await admitted.json()) as { id: string }).id;
      const wrongRunner = await fetch(`${base}/internal/runner/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${source}`, "content-type": "application/json" },
        body: "{}",
      });
      expect(wrongRunner.status).toBe(401);
      expect(wrongRunner.headers.get("cache-control")).toBe("no-store");
      expect(wrongRunner.headers.get("x-request-id")).toBeTruthy();
      const wrongVerifier = await fetch(`${base}/internal/verification/frozen`, {
        method: "POST",
        headers: { authorization: `Bearer ${service}`, "content-type": "application/json" },
        body: "{}",
      });
      expect(wrongVerifier.status).toBe(401);
      const port = privateRunnerCommands({
        origin: base,
        secret: runnerSecret,
        scope: sandbox.scope,
        resumable: true,
        timeoutMs: 30000,
      });
      const job = await claimNext(port, sandbox, { scope: sandbox.scope, resumable: true });
      expect(job?.submissionId).toBe(submission);
      await executeAndStage(job!, port, sandbox, AbortSignal.timeout(120000));
      await finishAfterTeardown(port, sandbox, job!, AbortSignal.timeout(120000));
      const result = await fetch(`${base}/v1/submissions/${submission}`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(result.status).toBe(200);
      expect(await result.text()).toContain('"accepted"');
    } finally {
      await closeRuntime();
      await pool.end();
      await Promise.all([
        new Promise<void>((resolve) => queue.close(() => resolve())),
        new Promise<void>((resolve) => verifier.close(() => resolve())),
      ]);
      await rm(stateRoot, { recursive: true, force: true });
      for (const [key, value] of Object.entries(prior))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
  },
  180000,
);
