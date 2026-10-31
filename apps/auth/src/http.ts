import { Hono } from "hono";
import { hostedSignIn } from "./hosted-sign-in.ts";
import { publicAuthConfiguration } from "./public-config.ts";
import type { configuration } from "./config.ts";

type Handler = (request: Request) => Promise<Response | undefined>;

export function createAuthApp(options: {
  config: ReturnType<typeof configuration>;
  auth: { handler(request: Request): Promise<Response> };
  registration?: Handler;
  profile?: Handler;
}) {
  const app = new Hono();
  app.get("/api/auth/quorem-config", (context) =>
    context.json(publicAuthConfiguration(options.config), 200, { "Cache-Control": "no-store" }),
  );
  app.all("/api/auth/*", async (context) => {
    const request = context.req.raw;
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/sign-in/hosted")
      return hostedSignIn(request, options.config.method, options.auth.handler);
    if (path.startsWith("/api/auth/registration/"))
      return (await options.registration?.(request)) ?? new Response(null, { status: 404 });
    if (
      path === "/api/auth/profile" ||
      path === "/api/auth/profile-photo" ||
      path.startsWith("/api/auth/profile-photos/")
    )
      return (await options.profile?.(request)) ?? new Response(null, { status: 404 });
    return options.auth.handler(request);
  });
  return app;
}
