import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { isolatedImageProcessor } from "./adapters/isolated-image.ts";
import type { ImageFormat } from "./image-processing.ts";

export function createImageService(options: {
  token: string;
  tls?: { key: string | Buffer; cert: string | Buffer };
  local: boolean;
  timeoutMs?: number;
}) {
  if (options.token.length < 32 || /[\r\n]/.test(options.token) || (!options.local && !options.tls))
    throw new Error("Invalid image service configuration");
  const processor = isolatedImageProcessor(options.timeoutMs);
  let active = 0;
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (
      !options.tls &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.localAddress ?? "")
    ) {
      res.writeHead(403).end();
      return;
    }
    const received = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/") {
      res.writeHead(404).end();
      return;
    }
    const format = req.headers["x-image-format"];
    if (format !== "png" && format !== "jpeg" && format !== "webp") {
      res.writeHead(400).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          res.writeHead(413, { "x-image-execution": "terminated" }).end();
          return;
        }
        chunks.push(chunk);
      }
      if (res.destroyed) return;
      if (active >= 4) {
        res.writeHead(503, { "x-image-execution": "terminated" }).end();
        return;
      }
      active++;
      const signal = new AbortController();
      res.once("close", () => {
        if (!res.writableFinished) signal.abort();
      });
      let result;
      try {
        result = await processor.process(
          Buffer.concat(chunks),
          format as ImageFormat,
          signal.signal,
        );
      } finally {
        active--;
      }
      const headers = { "x-image-execution": "terminated", "cache-control": "no-store" };
      if (result.kind === "processed")
        res.writeHead(200, { ...headers, "content-type": "image/webp" }).end(result.bytes);
      else res.writeHead(result.kind === "unsupported" ? 415 : 422, headers).end();
    } catch {
      if (!res.destroyed) res.writeHead(503, { "x-image-execution": "terminated" }).end();
    }
  };
  const server = options.tls
    ? createHttpsServer(options.tls, (req, res) => {
        void handler(req, res);
      })
    : createHttpServer((req, res) => {
        void handler(req, res);
      });
  server.requestTimeout = 12000;
  server.maxConnections = 16;
  return server;
}
