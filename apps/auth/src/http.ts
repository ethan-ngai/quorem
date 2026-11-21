import { Hono, type Context } from "hono";
import { hostedSignIn } from "./hosted-sign-in.ts";
import { publicAuthConfiguration } from "./public-config.ts";
import type { configuration } from "./config.ts";

type Handler = (request: Request) => Promise<Response | undefined>;

/** Retired clients receive a terminal response without entering auth or rate limiting. */
export function retiredAccountRoute(path: string): Response | undefined {
  if (path === "/api/auth/token" || path === "/api/auth/jwks")
    return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
}

function adoptResponse(context: Context, response: Response) {
  const inherited = new Headers(context.res.headers);
  context.res.headers.delete("set-cookie");
  const headers = new Headers(response.headers);
  for (const [name, value] of inherited) {
    if (name !== "set-cookie") headers.set(name, value);
  }
  for (const cookie of inherited.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAuthApp(options: {
  config: ReturnType<typeof configuration>;
  auth: { handler(request: Request): Promise<Response> };
  registration?: Handler;
  sudo?: Handler;
  profile?: Handler;
}) {
  const app = new Hono();
  app.get("/api/auth/quorem-config", (context) =>
    context.json(publicAuthConfiguration(options.config), 200, { "Cache-Control": "no-store" }),
  );
  app.all("/api/auth/*", async (context) => {
    const request = context.req.raw;
    const path = new URL(request.url).pathname;
    const retired = retiredAccountRoute(path);
    if (retired) return adoptResponse(context, retired);
    let response: Response;
    if (path.startsWith("/api/auth/sudo/"))
      response = (await options.sudo?.(request)) ?? new Response(null, { status: 404 });
    else if (path === "/api/auth/sign-in/hosted")
      response = await hostedSignIn(request, options.config.method, (next) =>
        options.auth.handler(next),
      );
    else if (path.startsWith("/api/auth/registration/"))
      response = (await options.registration?.(request)) ?? new Response(null, { status: 404 });
    else if (
      path === "/api/auth/profile" ||
      path === "/api/auth/profile-photo" ||
      path.startsWith("/api/auth/profile-photos/")
    ) {
      try {
        response = (await options.profile?.(request)) ?? new Response(null, { status: 404 });
      } catch {
        response = new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    } else response = await options.auth.handler(request);
    return adoptResponse(context, response);
  });
  return app;
}
