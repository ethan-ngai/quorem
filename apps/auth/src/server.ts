import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { toNodeHandler } from "better-auth/node";
import { auth, config, database } from "./auth.ts";
import { createProfileHandler } from "./profile.ts";
import { createRegistrationHandler } from "./registration.ts";
import { verificationMail, profileStorage } from "./infrastructure.ts";
import { hostedSignIn } from "./hosted-sign-in.ts";
import { publicAuthConfiguration } from "./public-config.ts";
const handler = toNodeHandler(auth);
const registrationHandler =
  config.registration && verificationMail
    ? createRegistrationHandler({
        database,
        origin: config.origin,
        send: verificationMail,
      })
    : undefined;
const profileHandler = createProfileHandler({
  origin: config.origin,
  session: (headers) => auth.api.getSession({ headers }),
  storage: profileStorage,
  repository: {
    async read(id) {
      const result = await database.query(
        'SELECT id,name,email,username,image,profile_color FROM "user" WHERE id=$1',
        [id],
      );
      return result.rows[0];
    },
    async setColor(id, color) {
      await database.query(
        'UPDATE "user" SET profile_color=$2,profile_color_revision=GREATEST(profile_color_revision+1, floor(extract(epoch from clock_timestamp()) * 1000)::bigint),"updatedAt"=NOW() WHERE id=$1',
        [id, color],
      );
    },
    async replace(id, previous, next) {
      const result = await database.query(
        'UPDATE "user" SET image=$3,"updatedAt"=NOW() WHERE id=$1 AND image IS NOT DISTINCT FROM $2 RETURNING id',
        [id, previous, next],
      );
      return result.rowCount === 1;
    },
    async contains(image) {
      const result = await database.query('SELECT 1 FROM "user" WHERE image=$1 LIMIT 1', [image]);
      return result.rowCount === 1;
    },
  },
});
const server = createServer(async (req, res) => {
  if (req.url === "/api/auth/quorem-config" && req.method === "GET") {
    res
      .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify(publicAuthConfiguration(config)));
    return;
  }
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
        'SELECT (SELECT EXTRACT(EPOCH FROM strong_at)::bigint FROM session_assurance WHERE session_id=s.id) AS strong_at FROM "session" s JOIN "user" u ON u.id=s."userId" WHERE s.id=$1 AND s."expiresAt">NOW() AND u.id=$2 AND u."emailVerified"=true',
        [id, req.headers["x-auth-subject"]],
      );
      if (result.rowCount === 1 && result.rows[0].strong_at)
        res.setHeader("X-Auth-Strong-At", String(result.rows[0].strong_at));
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
    if (
      req.url === "/api/auth/sign-in/hosted" ||
      req.url?.startsWith("/api/auth/profile") ||
      req.url?.startsWith("/api/auth/registration/")
    ) {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const requestOptions: RequestInit & { duplex?: "half" } = { method: req.method, headers };
      if (!["GET", "HEAD"].includes(req.method ?? "GET")) {
        requestOptions.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
        requestOptions.duplex = "half";
      }
      const request = new Request(config.origin + req.url, requestOptions);
      const response =
        req.url === "/api/auth/sign-in/hosted"
          ? await hostedSignIn(request, config.method, auth.handler)
          : req.url.startsWith("/api/auth/registration/")
            ? ((await registrationHandler?.(request)) ?? new Response(null, { status: 404 }))
            : await profileHandler(request);
      if (response) {
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));
        return;
      }
    }
    await handler(req, res);
  } catch {
    res.writeHead(503).end();
  }
});
server.requestTimeout = 15000;
server.listen(Number(process.env.AUTH_PORT ?? 8082), process.env.AUTH_HOST ?? "127.0.0.1");

// Overlap the first TLS/database handshake with login-page interaction.
void database.query("SELECT 1").catch(() => {
  console.warn("Auth database warmup unavailable");
});
