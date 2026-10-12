/** @file main.ts @description Local WebSocket-to-isolated-Python-LSP adapter. @module language */
import { managedOwner } from "./identity.ts";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import { authorizeUpgrade, validateMessage, hasManagedCredentials } from "./policy.ts";
import { retryableCleanup } from "./cleanup.ts";

const localIdentity = process.env.QUOREM_DEV_IDENTITY === "true";
if (
  (localIdentity && process.env.NODE_ENV === "production") ||
  (!localIdentity && (!process.env.AUTH_ORIGIN || !process.env.API_IDENTITY_URL))
)
  throw new Error("Language identity configuration required");
const address = process.env.LANGUAGE_ADDR ?? "127.0.0.1:8081";
const [host, portText] = address.split(":");
const port = Number(portText);
if (!isIP(host) || host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Language adapter requires a loopback IPv4 address and valid port");
}
const execute = promisify(execFile);
type Session = { client: WebSocket; stop: (code?: number, reason?: string) => Promise<void> };
const sessions = new Map<string, Session>();
const admissions = new Map<string, WebSocket>();
const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: 2 * 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has("quorem") ? "quorem" : false),
});
let shuttingDown = false;
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "language", mode: "local" }));
  } else {
    response.writeHead(404).end();
  }
});

server.on("upgrade", async (request, socket, head) => {
  let url: URL;
  try {
    url = new URL(request.url ?? "/", `http://${address}`);
  } catch {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }
  if (
    localIdentity &&
    hasManagedCredentials(request.headers.authorization, request.headers["sec-websocket-protocol"])
  ) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const owner = localIdentity
    ? authorizeUpgrade(request.socket.remoteAddress, request.headers.origin, url)
    : await managedOwner(
        request.headers["sec-websocket-protocol"],
        request.headers.origin,
        url.pathname,
      );
  if (!owner || shuttingDown) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => {
    client.pause();
    client.on("error", () => {});
    if (!localIdentity) {
      const check = setInterval(() => {
        void managedOwner(
          request.headers["sec-websocket-protocol"],
          request.headers.origin,
          url.pathname,
        ).then((current) => {
          if (current !== owner) client.close(1008, "Sign in required");
        });
      }, 15000);
      client.once("close", () => clearInterval(check));
    }
    void admit(owner, client, url.searchParams.get("takeover") === "1");
  });
});

async function admit(owner: string, client: WebSocket, takeover: boolean): Promise<void> {
  const prior = sessions.get(owner);
  if (prior?.client.readyState === WebSocket.OPEN && !takeover) {
    client.close(4009, "Language session already active; explicit takeover required");
    client.resume();
    return;
  }
  admissions.set(owner, client);
  if (prior) {
    try {
      await prior.stop(4009, "Editor session replaced");
    } catch {
      client.close(1011, "Previous language engine cleanup failed");
      client.resume();
      return;
    }
  }
  // Rapid focus changes can await the same teardown; only the newest window may start.
  if (
    shuttingDown ||
    admissions.get(owner) !== client ||
    sessions.has(owner) ||
    client.readyState !== WebSocket.OPEN
  ) {
    client.close(4009, "Language session unavailable");
    client.resume();
    return;
  }
  admissions.delete(owner);
  const session = bridge(owner, client);
  sessions.set(owner, session);
}

function bridge(owner: string, client: WebSocket): Session {
  const name = `quorem-language-${randomUUID()}`;
  const decoder = new FrameDecoder();
  let child: ReturnType<typeof spawn> | undefined;
  let stopped = false;
  let idle = setTimeout(() => void stopSafely(), 30 * 60 * 1000);
  // Create completes before cleanup, preventing a late start from orphaning a container.
  const creation = execute(
    "docker",
    [
      "create",
      "-i",
      "--name",
      name,
      "--label",
      `quorem.language.owner=${owner}`,
      "--label",
      `quorem.language.address=${address}`,
      "--network",
      "none",
      "--read-only",
      "--memory",
      "512m",
      "--memory-swap",
      "512m",
      "--cpus",
      "1",
      "--pids-limit",
      "32",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=32m",
      "--user",
      "65534:65534",
      "--env",
      // Cold global completion loads Python's standard-library type graph.
      "NODE_OPTIONS=--max-old-space-size=384",
      "quorem-language:local",
    ],
    { timeout: 2000 },
  );

  const cleanup = retryableCleanup(async () => {
    await creation.catch(() => {});
    child?.stdin?.end();
    try {
      await execute("docker", ["rm", "-f", name], { timeout: 2000 });
    } catch (error) {
      const failure = error as { stderr?: string };
      if (!failure.stderr?.includes("No such container")) throw error;
    }
    child?.kill("SIGTERM");
    client.terminate();
    if (sessions.get(owner) === session) sessions.delete(owner);
  });

  function stop(code = 1000, reason = "Language session closed"): Promise<void> {
    stopped = true;
    clearTimeout(idle);
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    // Reserve the owner until Docker confirms removal; later admissions can retry failures.
    return cleanup();
  }

  async function stopSafely(code?: number, reason?: string): Promise<void> {
    try {
      await stop(code, reason);
    } catch {
      client.terminate();
      console.error("Language container cleanup failed; owner remains reserved");
    }
  }

  const session: Session = { client, stop };
  client.on("message", (data, binary) => {
    try {
      if (binary || stopped || !child?.stdin) throw new Error("Invalid language message");
      const text = (
        Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)
      ).toString("utf8");
      validateMessage(text);
      clearTimeout(idle);
      idle = setTimeout(() => void stopSafely(), 30 * 60 * 1000);
      if (child.stdin.writableLength > 2 * 1024 * 1024) throw new Error("Language input backlog");
      child.stdin.write(encodeFrame(text));
    } catch {
      void stopSafely(1008, "Invalid language request");
    }
  });
  client.on("error", () => void stopSafely());
  client.on("close", () => void stopSafely());
  void creation
    .then(() => {
      if (stopped) return;
      child = spawn("docker", ["start", "-a", "-i", name], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout?.on("data", (chunk: Buffer) => {
        try {
          for (const message of decoder.push(chunk)) {
            if (client.bufferedAmount > 2 * 1024 * 1024) throw new Error("Language output backlog");
            if (client.readyState === WebSocket.OPEN) client.send(message);
          }
        } catch {
          void stopSafely(1011, "Language output unavailable");
        }
      });
      child.stdin?.on("error", () => void stopSafely());
      child.stderr?.on("data", () => {});
      child.on("error", () => void stopSafely(1011, "Language engine unavailable"));
      child.on("exit", () => void stopSafely());
      client.resume();
    })
    .catch(() => void stopSafely(1011, "Language engine unavailable"));
  return session;
}

server.listen(port, host, () => console.log(`Quorem language adapter: http://${address}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    sockets.close();
    void Promise.allSettled(
      [...sessions.values()].map((session) => session.stop(1001, "Service shutting down")),
    ).then((results) =>
      process.exit(results.some((result) => result.status === "rejected") ? 1 : 0),
    );
  });
}
