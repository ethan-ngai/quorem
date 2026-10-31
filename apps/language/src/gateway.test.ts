import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

async function start(port: number, extra: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/main.ts"], {
    env: {
      ...process.env,
      LANGUAGE_ADDR: `127.0.0.1:${port}`,
      QUOREM_HOSTED_INTELLIGENCE: "true",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {}
    if (child.exitCode !== null) throw new Error(output);
    await delay(25);
  }
  child.kill();
  throw new Error(`gateway startup timed out ${output}`);
}
function open(port: number, path: string, protocols?: string[]) {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, {
    origin: "http://localhost:5173",
  });
}
function status(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => reject(new Error("unexpected upgrade")));
    socket.once("error", reject);
  });
}
void test("managed gateway separates access denial from authority outage", async () => {
  let responseStatus = 401;
  const authority = createServer((_request, response) => {
    response.writeHead(responseStatus, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((resolve) => authority.listen(0, "127.0.0.1", resolve));
  const authorityPort = (authority.address() as { port: number }).port;
  const child = await start(18084, {
    QUOREM_DEV_IDENTITY: "false",
    AUTH_ORIGIN: "http://localhost:5173",
    API_IDENTITY_URL: `http://127.0.0.1:${authorityPort}`,
  });
  try {
    assert.equal(await status(open(18084, "/lsp", ["quorem", "bearer.token"])), 403);
    responseStatus = 503;
    assert.equal(await status(open(18084, "/lsp", ["quorem", "bearer.token"])), 503);
    assert.equal(await status(open(18084, "/lsp?language=java", ["quorem", "bearer.token"])), 400);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise<void>((resolve) => authority.close(() => resolve()));
  }
});
void test(
  "actual isolated sessions enforce capacity and idle limits",
  { skip: process.env.QUOREM_LANGUAGE_TEST !== "true", timeout: 15000 },
  async () => {
    const child = await start(18085, {
      QUOREM_DEV_IDENTITY: "true",
      LANGUAGE_MAX_SESSIONS: "1",
      LANGUAGE_IDLE_TIMEOUT: "1s",
    });
    const sockets: WebSocket[] = [];
    try {
      const first = open(18085, "/lsp?user=alice");
      sockets.push(first);
      await new Promise<void>((resolve, reject) => {
        first.once("open", resolve);
        first.once("error", reject);
      });
      const closed = new Promise<number>((resolve) => first.once("close", resolve));
      await delay(300);
      const second = open(18085, "/lsp?user=bob");
      sockets.push(second);
      const capped = new Promise<number>((resolve) => second.once("close", resolve));
      await new Promise<void>((resolve, reject) => {
        second.once("open", resolve);
        second.once("error", reject);
      });
      assert.equal(await capped, 1013);
      assert.equal(await closed, 4008);
    } finally {
      for (const socket of sockets) socket.terminate();
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  },
);

void test("engine EOF with a truncated frame closes the session and removes its process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorem-language-engine-"));
  const log = join(directory, "log");
  const fake = `#!/bin/sh\necho "$1" >> "$LANGUAGE_FAKE_LOG"\nif [ "$1" = start ]; then printf 'Content-Length: 3\\r\\n\\r\\n{'; fi\n`;
  await writeFile(join(directory, "docker"), fake, { mode: 0o755 });
  const child = await start(18086, {
    QUOREM_DEV_IDENTITY: "true",
    PATH: `${directory}:${process.env.PATH}`,
    LANGUAGE_FAKE_LOG: log,
  });
  try {
    const socket = open(18086, "/lsp?user=alice");
    socket.on("error", () => {});
    const code = await new Promise<number>((resolve) => socket.once("close", resolve));
    assert.equal(code, 1011);
    let content = "";
    for (let i = 0; i < 40; i++) {
      content = await (await import("node:fs/promises")).readFile(log, "utf8");
      if (content.includes("rm")) break;
      await delay(25);
    }
    assert.match(content, /create/);
    assert.match(content, /start/);
    assert.match(content, /rm/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

void test("managed verified entitlement opens only quorem protocol without forwarding bearer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorem-language-managed-"));
  const log = join(directory, "log");
  await writeFile(
    join(directory, "docker"),
    '#!/bin/sh\necho "$*" >> "$LANGUAGE_FAKE_LOG"\nif [ "$1" = start ]; then cat >/dev/null; fi\n',
    { mode: 0o755 },
  );
  const authority = createServer((_request, response) =>
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        mode: "managed",
        kind: "account",
        user: { id: "managed-owner", emailVerified: true },
        capabilities: { hostedIntelligence: true },
      }),
    ),
  );
  await new Promise<void>((resolve) => authority.listen(0, "127.0.0.1", resolve));
  const port = (authority.address() as { port: number }).port;
  const child = await start(18087, {
    QUOREM_DEV_IDENTITY: "false",
    AUTH_ORIGIN: "http://localhost:5173",
    API_IDENTITY_URL: `http://127.0.0.1:${port}`,
    PATH: `${directory}:${process.env.PATH}`,
    LANGUAGE_FAKE_LOG: log,
  });
  try {
    const socket = open(18087, "/lsp", ["quorem", "bearer.secret-token"]);
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("open", resolve));
    assert.equal(socket.protocol, "quorem");
    for (let i = 0; i < 40; i++) {
      try {
        if ((await (await import("node:fs/promises")).readFile(log, "utf8")).includes("start"))
          break;
      } catch {}
      await delay(25);
    }
    socket.close();
    await new Promise((resolve) => socket.once("close", resolve));
    const content = await (await import("node:fs/promises")).readFile(log, "utf8");
    assert.match(content, /quorem.language.owner=managed-owner/);
    assert.doesNotMatch(content, /secret-token/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise<void>((resolve) => authority.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

void test("pending identity requests respect the upgrade limit", async () => {
  let requests = 0;
  const authority = createServer(() => {
    requests++;
  });
  await new Promise<void>((resolve) => authority.listen(0, "127.0.0.1", resolve));
  const port = (authority.address() as { port: number }).port;
  const child = await start(18088, {
    QUOREM_DEV_IDENTITY: "false",
    LANGUAGE_MAX_SESSIONS: "1",
    AUTH_ORIGIN: "http://localhost:5173",
    API_IDENTITY_URL: `http://127.0.0.1:${port}`,
  });
  const first = open(18088, "/lsp", ["quorem", "bearer.one"]),
    second = open(18088, "/lsp", ["quorem", "bearer.two"]);
  first.on("error", () => {});
  second.on("error", () => {});
  try {
    for (let i = 0; i < 100 && requests < 2; i++) await delay(10);
    assert.equal(requests, 2);
    assert.equal(await status(open(18088, "/lsp", ["quorem", "bearer.three"])), 503);
  } finally {
    first.terminate();
    second.terminate();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    authority.closeAllConnections();
    await new Promise<void>((resolve) => authority.close(() => resolve()));
  }
});

void test(
  "managed session closes after live entitlement revocation",
  { skip: process.env.QUOREM_LANGUAGE_TEST !== "true", timeout: 22000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "quorem-language-revoke-"));
    await writeFile(
      join(directory, "docker"),
      '#!/bin/sh\nif [ "$1" = start ]; then cat >/dev/null; fi\n',
      { mode: 0o755 },
    );
    let allowed = true;
    const authority = createServer((_request, response) =>
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            mode: "managed",
            kind: "account",
            user: { id: "managed-owner", emailVerified: true },
            capabilities: { hostedIntelligence: allowed },
          }),
        ),
    );
    await new Promise<void>((resolve) => authority.listen(0, "127.0.0.1", resolve));
    const port = (authority.address() as { port: number }).port;
    const child = await start(18089, {
      QUOREM_DEV_IDENTITY: "false",
      AUTH_ORIGIN: "http://localhost:5173",
      API_IDENTITY_URL: `http://127.0.0.1:${port}`,
      PATH: `${directory}:${process.env.PATH}`,
    });
    try {
      const socket = open(18089, "/lsp", ["quorem", "bearer.token"]);
      socket.on("error", () => {});
      await new Promise<void>((resolve) => socket.once("open", resolve));
      const closed = new Promise<number>((resolve) => socket.once("close", resolve));
      allowed = false;
      assert.equal(await closed, 1008);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      authority.closeAllConnections();
      await new Promise<void>((resolve) => authority.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
