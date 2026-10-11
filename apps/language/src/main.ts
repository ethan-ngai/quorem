/** @file main.ts @description Local WebSocket-to-isolated-Python-LSP adapter. @module language */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import { authorizeUpgrade, validateMessage } from "./policy.ts";

if (process.env.NODE_ENV === "production" || process.env.QUOREM_DEV_IDENTITY !== "true") {
  throw new Error("Local language adapter requires explicit development identity mode");
}

const sessions = new Map<string, WebSocket>();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "language", mode: "local" }));
  } else {
    response.writeHead(404).end();
  }
});

server.on("upgrade", (request, socket, head) => {
  const owner = authorizeUpgrade(
    request.socket.remoteAddress,
    request.headers.origin,
    new URL(request.url ?? "/", "http://localhost:8081"),
  );
  if (!owner) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => {
    const prior = sessions.get(owner);
    if (prior) prior.close(4009, "Editor session replaced");
    sessions.set(owner, client);
    bridge(owner, client);
  });
});

function bridge(owner: string, client: WebSocket): void {
  const name = `quorem-language-${randomUUID()}`;
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--memory",
      "256m",
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
      "NODE_OPTIONS=--max-old-space-size=192",
      "quorem-language:local",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const decoder = new FrameDecoder();
  let stopped = false;
  let idle = setTimeout(stop, 30 * 60 * 1000);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(idle);
    if (sessions.get(owner) === client) sessions.delete(owner);
    child.stdin.end();
    child.kill("SIGTERM");
    const cleanup = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
    cleanup.on("error", () => {});
    if (client.readyState === WebSocket.OPEN) client.close(1000, "Language session closed");
  }

  client.on("message", (data, binary) => {
    try {
      if (binary || stopped) throw new Error("Invalid language message");
      const text = (
        Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)
      ).toString("utf8");
      validateMessage(text);
      clearTimeout(idle);
      idle = setTimeout(stop, 30 * 60 * 1000);
      if (child.stdin.writableLength > 2 * 1024 * 1024) throw new Error("Language input backlog");
      child.stdin.write(encodeFrame(text));
    } catch {
      client.close(1008, "Invalid language request");
      stop();
    }
  });
  child.stdout.on("data", (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) {
        if (client.bufferedAmount > 2 * 1024 * 1024) throw new Error("Language output backlog");
        if (client.readyState === WebSocket.OPEN) client.send(message);
      }
    } catch {
      client.close(1011, "Language output unavailable");
      stop();
    }
  });
  child.stdin.on("error", stop);
  child.stderr.on("data", () => {});
  child.on("error", () => {
    client.close(1011, "Language engine unavailable");
    stop();
  });
  child.on("exit", stop);
  client.on("error", stop);
  client.on("close", stop);
}

server.listen(8081, "127.0.0.1", () =>
  console.log("Quorem language adapter: http://127.0.0.1:8081"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const client of sessions.values()) client.close(1001, "Service shutting down");
    sockets.close();
    server.close();
  });
}
