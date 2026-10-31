/** @file browser-fixture.ts @description Guarded local browser stack with real auth and execution. @module runtime */
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { createNodeRuntime } from "@quorem/auth/node";
import { seedAccounts } from "../../../../auth/src/seed-accounts.ts";
import { applyAccess } from "../../cli/access.ts";
import { dockerSandbox } from "../../../../runner/src/sandbox/docker.ts";
import { bootstrapRuntimeFixture } from "./fixture.ts";
import { assertRuntimeTestDatabase } from "./test-database.ts";
import { startNodeRuntime } from "../node.ts";

const apiOrigin = "http://127.0.0.1:8765",
  webOrigin = "http://127.0.0.1:5187";
const verifierOrigin = "http://127.0.0.1:18761",
  runnerOrigin = "http://127.0.0.1:18762";
const random = () => randomBytes(32).toString("hex");
const root = resolve(import.meta.dirname, "../../../../..");

/** This fixture may reset only its separately provisioned local database. */
export function assertBrowserDatabase(value: string): void {
  assertRuntimeTestDatabase(value);
  if (new URL(value).port !== "55701") throw new Error("Browser fixture requires port 55701");
}
function command(name: string, args: string[]) {
  if (spawnSync(name, args, { stdio: "ignore" }).status !== 0)
    throw new Error("Fixture prerequisite unavailable");
}
async function health(origin: string, child?: ChildProcess) {
  for (let i = 0; i < 150; i++) {
    if (child && (!child.pid || child.exitCode !== null || child.signalCode !== null)) break;
    try {
      if ((await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Fixture service unavailable");
}
async function stop(child: ChildProcess, cleanExit = true) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (cleanExit && (child.exitCode !== 0 || child.signalCode !== null))
      throw new Error("Fixture process failed");
    return;
  }
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code, signal] = await Promise.race([
      once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture process did not drain")), 30000);
      }),
    ]);
    if (cleanExit && (code !== 0 || signal !== null))
      throw new Error("Fixture process did not confirm shutdown");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function start(commandName: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(commandName, args, {
    cwd: root,
    env,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  child.on("error", () => {});
  return child;
}

async function closeServer(server: Server) {
  if (server.listening)
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

export async function startBrowserFixture(database: string, socket: string) {
  assertBrowserDatabase(database);
  if (!socket.startsWith("/") || !(await stat(socket)).isSocket())
    throw new Error("Fixture Docker socket required");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node 24 or later required");
  const docker = ["--config", "/nonexistent", "--host", `unix://${socket}`];
  command("docker", [...docker, "info"]);
  for (const image of ["python", "java", "typescript", "ocaml", "postgres"])
    command("docker", [...docker, "image", "inspect", `quorem-${image}:local`]);
  command("vp", ["--version"]);
  const temp = await mkdtemp(join(tmpdir(), "quorem-browser-37j-"));
  const password = `${random()}Aa1!`,
    authSecret = random(),
    runnerSecret = random(),
    drainSecret = random(),
    sourceKey = random(),
    verifierKey = random(),
    namespace = `browser-${randomBytes(12).toString("hex")}`;
  const previousAws = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };
  let cleanup: (() => Promise<void>) | undefined,
    runtime: Awaited<ReturnType<typeof startNodeRuntime>> | undefined,
    runner: ChildProcess | undefined,
    verifier: ChildProcess | undefined,
    vite: ChildProcess | undefined;
  let pool: ReturnType<typeof createNodePool> | undefined;
  const queue = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) req.destroy();
      else chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          MessageBody?: unknown;
        };
        if (req.method !== "POST" || typeof body.MessageBody !== "string")
          throw new Error("Invalid fixture wake");
        res.writeHead(200, { "content-type": "application/x-amz-json-1.0" }).end(
          JSON.stringify({
            MessageId: crypto.randomUUID(),
            MD5OfMessageBody: createHash("md5").update(body.MessageBody).digest("hex"),
          }),
        );
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  let closing = false;
  const finish = async () => {
    closing = true;
    if (vite) await stop(vite, false);
    if (runner) await stop(runner);
    if (runtime) await runtime.close();
    if (verifier) await stop(verifier);
    if (pool) await pool.end();
    await closeServer(queue);
    for (const [key, value] of Object.entries(previousAws)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (cleanup) await cleanup();
    await rm(temp, { recursive: true, force: true });
  };
  try {
    cleanup = await bootstrapRuntimeFixture(database);
    pool = createNodePool({
      connectionString: database,
      max: 3,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const authEnv = {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: webOrigin,
      AUTH_DATABASE_URL: database,
      DATABASE_URL: database,
      BETTER_AUTH_SECRET: authSecret,
      AUTH_INTERNAL_SECRET: random(),
    };
    const auth = await createNodeRuntime(authEnv);
    let actors: Awaited<ReturnType<typeof seedAccounts>>;
    try {
      actors = await seedAccounts(auth, password, database);
    } finally {
      await auth.database.end();
    }
    const operator = await pool.query(
      `SELECT 1 FROM access_audit a JOIN identity_bindings b ON b.user_id=a.user_id AND b.subject=a.scope JOIN quorem_auth."user" u ON u.id=b.subject JOIN users p ON p.id=b.user_id WHERE a.operation_id='bootstrap:operator' AND b.issuer='http://127.0.0.1:8765' AND u."emailVerified" AND p.role='admin' AND NOT p.disabled`,
    );
    if (operator.rowCount !== 1) throw new Error("Verified fixture operator required");
    for (const actor of actors) {
      const row = (
        await pool.query<{ user_id: string }>(
          "SELECT user_id FROM identity_bindings WHERE issuer=$1 AND subject=$2",
          [webOrigin, actor.subject],
        )
      ).rows[0];
      if (!row) throw new Error("Fixture identity unavailable");
      for (const feature of ["interviews.host", "matches.host_guests"])
        await withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
          applyAccess(scope, "grant", {
            user: row.user_id,
            scope: feature,
            actor: "runtime-fixture-operator",
            reason: "Disposable browser smoke",
            opId: `browser:${actor.username}:${feature}`,
            source: "manual",
            ref: "browser-fixture",
            resource: "",
            value: 0,
            dry: false,
          }),
        );
    }
    await writeFile(
      join(temp, "credentials.json"),
      JSON.stringify({ usernames: ["alice", "bob"], password }),
      { mode: 0o600, flag: "wx" },
    );
    const fenceRoot = await realpath(temp),
      sandbox = await dockerSandbox({ socket, stateRoot: fenceRoot, namespace, cleanupMs: 30000 });
    const keys = generateKeyPairSync("ed25519"),
      privateFile = join(temp, "verifier.pem");
    await writeFile(privateFile, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
      flag: "wx",
    });
    queue.listen(0, "127.0.0.1");
    await once(queue, "listening");
    const queuePort = (queue.address() as AddressInfo).port;
    Object.assign(process.env, {
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "local-fixture",
      AWS_SECRET_ACCESS_KEY: "local-fixture",
    });
    const childEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "production",
    };
    verifier = start(
      process.execPath,
      ["--experimental-strip-types", "apps/runner/src/runtime/verifier.ts"],
      {
        ...childEnv,
        QUOREM_VERIFIER_LISTEN: "127.0.0.1:18761",
        QUOREM_VERIFICATION_SOURCE_ORIGIN: apiOrigin,
        QUOREM_VERIFICATION_SOURCE_KEY: sourceKey,
        QUOREM_VERIFICATION_SERVICE_KEY: verifierKey,
        QUOREM_VERIFICATION_SIGNING_KEY_FILE: privateFile,
      },
    );
    await health(verifierOrigin, verifier);
    runtime = await startNodeRuntime({
      ...authEnv,
      HOST: "127.0.0.1",
      PORT: "8765",
      QUOREM_DATABASE_LISTEN_URL: database,
      QUOREM_ALLOWED_ORIGINS: webOrigin,
      MATCH_INVITE_KEY: random(),
      EXECUTION_WAKE_PROVIDER: "sqs",
      SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/browser-fixture",
      SQS_LOCAL_ENDPOINT: `http://127.0.0.1:${queuePort}`,
      IDENTITY_MODE: "managed",
      GUEST_CREATION: "true",
      GUEST_ADMISSION: "true",
      GUEST_EXECUTION: "true",
      RUNNER_PEERS: JSON.stringify([
        { secret: runnerSecret, scope: sandbox.scope, resumable: true },
      ]),
      VERIFICATION_SOURCE_CREDENTIAL: sourceKey,
      VERIFICATION_SERVICE_CREDENTIAL: verifierKey,
      VERIFICATION_ACCESS_MODE: "none",
      VERIFICATION_SERVICE_ORIGIN: verifierOrigin,
      VERIFICATION_PUBLIC_KEY: keys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    });
    runner = start(
      process.execPath,
      ["--experimental-strip-types", "apps/runner/src/runtime/runner.ts"],
      {
        ...childEnv,
        QUOREM_SANDBOX_PROVIDER: "docker",
        QUOREM_DOCKER_SOCKET: socket,
        QUOREM_DOCKER_FENCE_ROOT: fenceRoot,
        QUOREM_DOCKER_NAMESPACE: namespace,
        QUOREM_RUNNER_MODE: "continuous",
        QUOREM_RUNNER_LISTEN: "127.0.0.1:18762",
        QUOREM_RUNNER_COMMAND_ORIGIN: apiOrigin,
        QUOREM_RUNNER_COMMAND_SECRET: runnerSecret,
        QUOREM_RUNNER_DRAIN_SECRET: drainSecret,
        QUOREM_RUNNER_SLOTS: "2",
      },
    );
    await health(runnerOrigin, runner);
    vite = start("vp", ["-C", "apps/web", "dev", "--port", "5187"], {
      ...childEnv,
      QUOREM_API_DEV_ORIGIN: apiOrigin,
      QUOREM_AUTH_DEV_ORIGIN: apiOrigin,
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (!vite.pid || vite.exitCode !== null || vite.signalCode !== null) break;
      try {
        if ((await fetch(`${webOrigin}/practice`, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Browser fixture frontend unavailable");
    for (const username of ["alice", "bob"]) {
      const signedIn = await fetch(`${webOrigin}/api/auth/sign-in/username`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(5000),
      });
      if (!signedIn.ok) throw new Error("Fixture login unavailable");
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      if (!cookie) throw new Error("Fixture session unavailable");
      const issued = await fetch(`${webOrigin}/api/auth/token`, {
        headers: { cookie, origin: webOrigin },
        signal: AbortSignal.timeout(5000),
      });
      if (!issued.ok) throw new Error("Fixture bearer unavailable");
      const token = ((await issued.json()) as { token?: string }).token;
      if (!token) throw new Error("Fixture bearer unavailable");
      const session = await fetch(`${webOrigin}/v1/session`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!session.ok) throw new Error("Fixture session unavailable");
    }
    const failure = new Promise<never>((_, reject) => {
      for (const child of [runner, verifier, vite])
        child?.once("exit", () => {
          if (!closing) reject(new Error("Fixture service exited unexpectedly"));
        });
    });
    return {
      apiOrigin,
      webOrigin,
      credentialsFile: join(temp, "credentials.json"),
      close: finish,
      failure,
    };
  } catch (error) {
    try {
      await finish();
    } catch {
      throw new Error("Fixture startup failed; state retained because teardown is uncertain", {
        cause: error,
      });
    }
    throw error;
  }
}

if (import.meta.main) {
  const database = process.env.QUOREM_BROWSER_FIXTURE_DATABASE_URL,
    socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
  if (!database || !socket) throw new Error("Disposable database and Docker socket required");
  let fixture: Awaited<ReturnType<typeof startBrowserFixture>> | undefined,
    interrupted = false,
    stopping = false;
  const close = async () => {
    if (!fixture || stopping) return;
    stopping = true;
    try {
      await fixture.close();
    } catch {
      console.error("Fixture teardown unconfirmed; database and fence retained");
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      interrupted = true;
      void close();
    });
  try {
    fixture = await startBrowserFixture(database, socket);
    if (interrupted) await close();
    else {
      process.stdout.write(
        `Browser: ${fixture.webOrigin}\nAPI/auth: ${fixture.apiOrigin}\nCredentials: ${fixture.credentialsFile}\n`,
      );
      void fixture.failure.catch(() => {
        console.error("Fixture service exited unexpectedly");
        process.exitCode = 1;
        void close();
      });
    }
  } catch {
    console.error("Browser fixture failed; check isolated database and prerequisites");
    process.exitCode = 1;
  }
}
