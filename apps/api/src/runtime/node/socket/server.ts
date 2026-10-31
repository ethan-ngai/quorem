/** @file server.ts @description Node WebSocket transport for the shared realtime session. @module events */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { frameText } from "../../../adapters/events/fanout/common.ts";
import { SocketSession } from "../../../modules/events/socket/session.ts";
import { mapIdentityError } from "../../../modules/identity/routes.ts";
import { ApplicationError } from "../../../application/error.ts";
import type { SocketTransport } from "../../../modules/events/socket/ports.ts";
type SessionOptions = Omit<ConstructorParameters<typeof SocketSession>[0], "transport"> & {
  release?: () => Promise<void>;
};
export interface SocketGatewayOptions {
  origins: readonly string[];
  resolve(request: Request, signal: AbortSignal): Promise<SessionOptions | undefined>;
  heartbeatMs?: number;
}
function requestOf(req: IncomingMessage): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  return new Request(new URL(req.url ?? "/", "http://localhost"), { method: "GET", headers });
}
function transport(ws: WebSocket): SocketTransport {
  const operation = (signal: AbortSignal, start: (done: (error?: Error) => void) => void) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Socket closed"));
        return;
      }
      const abort = () => {
        ws.terminate();
        reject(new Error("Socket closed"));
      };
      signal.addEventListener("abort", abort, { once: true });
      start((error) => {
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      });
    });
  return {
    send(frame, signal) {
      if (ws.bufferedAmount > 256 * 1024) return Promise.reject(new Error("Socket backpressure"));
      return operation(signal, (done) => ws.send(frame, done));
    },
    ping(signal) {
      return operation(signal, (done) => ws.ping(done));
    },
    close(code, reason) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(code, reason);
        const t = setTimeout(() => ws.terminate(), 1000);
        t.unref();
        ws.once("close", () => clearTimeout(t));
      } else if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    },
  };
}
/** Installs only the upgrade handler; authority and composition are injected by the caller. */
export function installNodeSockets(
  server: Server,
  options: SocketGatewayOptions,
): () => Promise<void> {
  const heartbeat = options.heartbeatMs ?? 15000;
  if (!Number.isSafeInteger(heartbeat) || heartbeat < 1000 || heartbeat > 30000)
    throw new RangeError("Invalid heartbeat interval");
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
    perMessageDeflate: false,
    clientTracking: true,
    handleProtocols: (protocols) => (protocols.has("quorem") ? "quorem" : false),
  });
  let stopping = false;
  const pending = new Set<AbortController>();
  const cleanup = new Set<Promise<void>>();
  const releaseSafely = (release?: () => Promise<void>) => {
    if (!release) return;
    const job = Promise.resolve()
      .then(release)
      .catch(() => {});
    cleanup.add(job);
    void job.finally(() => cleanup.delete(job));
  };
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    const originCount = req.rawHeaders.filter(
      (_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "origin",
    ).length;
    const offered = (req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      stopping ||
      !origin ||
      originCount !== 1 ||
      !options.origins.includes(origin) ||
      req.method !== "GET" ||
      (offered.length > 0 && !offered.includes("quorem"))
    ) {
      socket.destroy();
      return;
    }
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref();
    const abort = () => socket.destroy();
    controller.signal.addEventListener("abort", abort, { once: true });
    socket.once("close", () => controller.abort());
    void (async () => {
      let release: (() => Promise<void>) | undefined;
      let attached = false;
      const bounded = <T>(promise: Promise<T>): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("Upgrade cancelled")),
              { once: true },
            ),
          ),
        ]);
      try {
        const request = requestOf(req);
        const resolution = options.resolve(request, controller.signal).then((value) => {
          if (controller.signal.aborted || stopping) {
            releaseSafely(value?.release);
            return undefined;
          }
          return value;
        });
        const resolved = await bounded(resolution);
        release = resolved?.release;
        if (!resolved || controller.signal.aborted || stopping) {
          socket.destroy();
          return;
        }
        const mapped = async <T>(fn: () => Promise<T>): Promise<T> => {
          try {
            return await fn();
          } catch (error) {
            throw mapIdentityError(error);
          }
        };
        const initial = await bounded(mapped(() => resolved.security.verify(controller.signal)));
        if (
          !initial.binding ||
          initial.binding.length > 256 ||
          (resolved.mode !== "invite" && !initial.principal) ||
          (initial.expiresAt !== undefined && initial.expiresAt <= Date.now())
        )
          throw new ApplicationError("unauthenticated", "Invalid socket grant", 401);
        await bounded(
          mapped(() => resolved.security.authorize(initial.principal, controller.signal)),
        );
        if (controller.signal.aborted || stopping) {
          socket.destroy();
          return;
        }
        const identity = (v: typeof initial) =>
          JSON.stringify([
            v.binding,
            v.principal?.kind,
            v.principal?.userId,
            v.principal?.sessionId,
          ]);
        const security = {
          verify: async (signal: AbortSignal) => {
            const value = await mapped(() => resolved.security.verify(signal));
            if (identity(value) !== identity(initial))
              throw new ApplicationError("unauthenticated", "Socket grant changed", 401);
            return value;
          },
          authorize: (principal: typeof initial.principal, signal: AbortSignal) =>
            mapped(() => resolved.security.authorize(principal, signal)),
        };
        wss.handleUpgrade(req, socket, head, (ws) => {
          attached = true;
          clearTimeout(timer);
          pending.delete(controller);
          controller.signal.removeEventListener("abort", abort);
          const session = new SocketSession({ ...resolved, security, transport: transport(ws) });
          let alive = true;
          ws.on("pong", () => {
            alive = true;
          });
          ws.on("message", (data, binary) => {
            if (binary) session.close(1008, "Invalid command");
            else session.receive(frameText(data));
          });
          ws.on("error", () => session.close(1011, "Socket unavailable"));
          ws.on("close", () => {
            session.close();
            releaseSafely(release);
          });
          const interval = setInterval(() => {
            if (!alive) {
              session.close(1001, "Heartbeat timeout");
              return;
            }
            alive = false;
            void session.heartbeat();
          }, heartbeat);
          interval.unref();
          ws.once("close", () => clearInterval(interval));
          void session.start();
        });
      } catch {
        socket.destroy();
      } finally {
        clearTimeout(timer);
        pending.delete(controller);
        if (!attached) releaseSafely(release);
      }
    })();
  };
  server.on("upgrade", upgrade);
  return async () => {
    if (stopping) return;
    stopping = true;
    server.off("upgrade", upgrade);
    for (const c of pending) c.abort();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await Promise.all(cleanup);
  };
}
