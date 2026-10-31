/** @file main.ts @description Local WebSocket-to-isolated-Python-LSP adapter. @module language */
import { IdentityUnavailable, managedOwner } from "./identity.ts";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import { authorizeUpgrade, validateMessage, hasManagedCredentials } from "./policy.ts";
import { retryableCleanup } from "./cleanup.ts";

const hostedEnabled = process.env.QUOREM_HOSTED_INTELLIGENCE === "true";
const localIdentity = process.env.QUOREM_DEV_IDENTITY === "true";
if (
  (localIdentity && process.env.NODE_ENV === "production") ||
  (hostedEnabled && !localIdentity && (!process.env.AUTH_ORIGIN || !process.env.API_IDENTITY_URL))
)
  throw new Error("Language identity configuration required");
const address = process.env.LANGUAGE_ADDR ?? "127.0.0.1:8081";
const [host, portText] = address.split(":");
const port = Number(portText);
if (!isIP(host) || host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Language adapter requires a loopback IPv4 address and valid port");
}
const maxSessions = Number(process.env.LANGUAGE_MAX_SESSIONS ?? "8");
if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 256)
  throw new Error("Invalid language capacity");
function duration(value: string): number {
  if (value.startsWith("+")) value = value.slice(1);
  const pattern = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;
  const units: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    μs: 1e-3,
    ms: 1,
    s: 1000,
    m: 60000,
    h: 3600000,
  };
  let elapsed = 0,
    offset = 0;
  while (offset < value.length) {
    pattern.lastIndex = offset;
    const part = pattern.exec(value);
    if (!part) throw new Error("Invalid idle timeout");
    elapsed += Number(part[1]) * units[part[2]!]!;
    offset = pattern.lastIndex;
  }
  if (!value || !Number.isFinite(elapsed) || elapsed < 1000 || elapsed > 9223372036854)
    throw new Error("Invalid idle timeout");
  return elapsed;
}
const idleTimeout = duration(process.env.LANGUAGE_IDLE_TIMEOUT ?? "5m");
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const origin = new URL(webOrigin);
if (
  origin.origin !== webOrigin ||
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  (localIdentity &&
    (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)))
)
  throw new Error("Invalid web origin");
if (hostedEnabled && !localIdentity) {
  const authOrigin = new URL(process.env.AUTH_ORIGIN!);
  const endpoint = new URL(process.env.API_IDENTITY_URL!);
  const safeTransport = (url: URL) =>
    url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  if (
    authOrigin.origin !== process.env.AUTH_ORIGIN ||
    !safeTransport(authOrigin) ||
    !safeTransport(endpoint) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid identity configuration");
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
let pendingAdmissions = 0;
const pendingSockets = new Set<import("node:stream").Duplex>();
const server = createServer({ maxHeaderSize: 32 * 1024 }, (request, response) => {
  if (request.url === "/health") {
    response.writeHead(shuttingDown ? 503 : 200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        status: shuttingDown ? "draining" : "ok",
        service: "language",
        gateway: "node",
        hostedEnabled,
        reservedSessions: sessions.size,
        capacity: maxSessions,
      }),
    );
  } else {
    response.writeHead(404).end();
  }
});

server.headersTimeout = 5000;
server.maxHeadersCount = 100;
server.on("upgrade", async (request, socket, head) => {
  if (!hostedEnabled) {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }
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
  if (url.pathname !== "/lsp") {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return;
  }
  const language = url.searchParams.get("language");
  if (language && language !== "python") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }
  if (shuttingDown || pendingSockets.size + pendingAdmissions >= maxSessions * 2) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  pendingSockets.add(socket);
  try {
    const owner = localIdentity
      ? authorizeUpgrade(request.socket.remoteAddress, request.headers.origin, url, webOrigin)
      : await managedOwner(
          request.headers["sec-websocket-protocol"],
          request.headers.origin,
          url.pathname,
        );
    if (shuttingDown || socket.destroyed) {
      socket.destroy();
      return;
    }
    if (!owner) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      client.pause();
      client.on("error", () => {});
      if (!localIdentity) {
        let checking = false;
        const check = setInterval(() => {
          if (checking) return;
          checking = true;
          void managedOwner(
            request.headers["sec-websocket-protocol"],
            request.headers.origin,
            url.pathname,
          )
            .then((current) => {
              if (current !== owner) client.close(1008, "Sign in required");
            })
            .catch(() => client.close(1011, "Identity service unavailable"))
            .finally(() => {
              checking = false;
            });
        }, 15000);
        client.once("close", () => clearInterval(check));
      }
      pendingAdmissions++;
      void admit(owner, client, url.searchParams.get("takeover") === "1")
        .catch(() => client.terminate())
        .finally(() => {
          pendingAdmissions--;
        });
    });
  } catch (error) {
    if (!socket.destroyed)
      socket.end(
        error instanceof IdentityUnavailable
          ? "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"
          : "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
      );
  } finally {
    pendingSockets.delete(socket);
  }
});

async function admit(owner: string, client: WebSocket, takeover: boolean): Promise<void> {
  const prior = sessions.get(owner);
  if (prior?.client.readyState === WebSocket.OPEN && !takeover) {
    client.close(4009, "Language session already active; explicit takeover required");
    client.resume();
    return;
  }
  admissions.set(owner, client);
  client.once("close", () => {
    if (admissions.get(owner) === client) admissions.delete(owner);
  });
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
  if (sessions.size >= maxSessions) {
    client.close(1013, "Language capacity reached. Try again shortly.");
    client.resume();
    return;
  }
  const session = bridge(owner, client);
  sessions.set(owner, session);
}

function bridge(owner: string, client: WebSocket): Session {
  const name = `quorem-language-${randomUUID()}`;
  const decoder = new FrameDecoder();
  let child: ReturnType<typeof spawn> | undefined;
  let stopped = false;
  let idle: ReturnType<typeof setTimeout>;
  function armIdle(deadline = Date.now() + idleTimeout): void {
    clearTimeout(idle);
    idle = setTimeout(
      () => {
        if (Date.now() >= deadline) void stopSafely(4008, "Language session idle");
        else armIdle(deadline);
      },
      Math.min(Math.max(0, deadline - Date.now()), 2147483647),
    );
  }
  armIdle();
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
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execute("docker", ["rm", "-f", name], { timeout: 2000 });
        failure = undefined;
        break;
      } catch (error) {
        if ((error as { stderr?: string }).stderr?.includes("No such container")) {
          failure = undefined;
          break;
        }
        failure = error;
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 50));
      }
    }
    if (failure) throw failure;
    if (child && child.exitCode === null && child.signalCode === null) {
      const process = child;
      const exited = new Promise<void>((resolve) => process.once("close", () => resolve()));
      process.kill("SIGTERM");
      const timer = setTimeout(() => process.kill("SIGKILL"), 1000);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Language process did not exit")), 2000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        clearTimeout(timeout);
      }
    }
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
      armIdle();
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
      child.stdout?.on("end", () => {
        try {
          decoder.finish();
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
    for (const socket of pendingSockets) socket.destroy();
    server.close();
    sockets.close();
    void Promise.allSettled(
      [...sessions.values()].map((session) => session.stop(1001, "Service shutting down")),
    ).then((results) =>
      process.exit(results.some((result) => result.status === "rejected") ? 1 : 0),
    );
  });
}
