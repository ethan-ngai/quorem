import { withNodeConnection } from "@quorem/database/core";
import { drizzleProfileBudget } from "./adapters/drizzle-profile-budget.ts";
import { drizzleProfileRepository } from "./adapters/drizzle-profile-repository.ts";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { toNodeHandler } from "better-auth/node";
import { createNodeRuntime } from "./node-auth.ts";
import { createProfileHandler } from "./profile.ts";
import { sharpImageProcessor } from "./adapters/sharp-image.ts";
import { hostedSignIn } from "./hosted-sign-in.ts";
import { publicAuthConfiguration } from "./public-config.ts";
export async function startServer(env: NodeJS.ProcessEnv = process.env) {
  const { auth, config, database, authRepository, registrationHandler, profileStorage } =
    await createNodeRuntime(env);
  const handler = toNodeHandler(auth);
  const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(database, { lifetimeMs: 15000 }, callback);
  const profileHandler = createProfileHandler({
    budget: drizzleProfileBudget(run),
    origin: config.origin,
    session: (headers) => auth.api.getSession({ headers }),
    storage: profileStorage,
    imageProcessor: sharpImageProcessor,
    repository: drizzleProfileRepository(run),
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
        const result = await authRepository.sessionAuthority(
          id,
          String(req.headers["x-auth-subject"] ?? ""),
        );
        if (result.valid && result.strongAt)
          res.setHeader("X-Auth-Strong-At", String(result.strongAt));
        res.writeHead(result.valid ? 204 : 401).end();
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
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const disconnected = new AbortController();
        req.once("aborted", () => disconnected.abort());
        res.once("close", () => {
          if (!res.writableFinished) disconnected.abort();
        });
        const requestOptions: RequestInit & { duplex?: "half" } = {
          method: req.method,
          headers,
          signal: disconnected.signal,
        };
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
  server.listen(Number(env.AUTH_PORT ?? 8082), env.AUTH_HOST ?? "127.0.0.1");

  // Overlap the first TLS/database handshake with login-page interaction.
  void database.query("SELECT 1").catch(() => {
    console.warn("Auth database warmup unavailable");
  });

  return { server, database };
}
if (import.meta.main) await startServer();
