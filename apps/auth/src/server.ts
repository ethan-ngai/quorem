import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { toNodeHandler } from "better-auth/node";
import { auth, config, database } from "./auth.ts";
const handler = toNodeHandler(auth);
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/internal/session/")) {
    const supplied = Buffer.from(String(req.headers.authorization ?? ""));
    const expected = Buffer.from(`Bearer ${config.internalSecret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end();
      return;
    }
    const id = decodeURIComponent(req.url.slice("/internal/session/".length));
    try {
      const result = await database.query(
        'SELECT 1 FROM "session" s JOIN "user" u ON u.id=s."userId" WHERE s.id=$1 AND s."expiresAt">NOW() AND u.id=$2 AND u."emailVerified"=true',
        [id, req.headers["x-auth-subject"]],
      );
      res.writeHead(result.rowCount === 1 ? 204 : 401).end();
    } catch {
      res.writeHead(503).end();
    }
    return;
  }
  if (!req.url?.startsWith("/api/auth/")) {
    res.writeHead(404).end();
    return;
  }
  try {
    await handler(req, res);
  } catch {
    res.writeHead(503).end();
  }
});
server.listen(Number(process.env.AUTH_PORT ?? 8082), "127.0.0.1");
