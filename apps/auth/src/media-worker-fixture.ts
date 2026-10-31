import { Hono } from "hono";
import { createAuthApp } from "./http.ts";
import { workerRuntime, type AuthWorkerEnv } from "./worker.ts";
export default {
  fetch(request: Request, env: AuthWorkerEnv) {
    const runtime = workerRuntime(
      {
        ...env,
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://127.0.0.1:58751",
        AUTH_INTERNAL_SECRET: "fixture-only",
        BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
        PROFILE_MEDIA_ENABLED: "true",
        PROFILE_IMAGE_SERVICE_URL: "http://127.0.0.1:58752/",
        PROFILE_IMAGE_SERVICE_TOKEN: "fixture-token-".repeat(3),
      },
      request.signal,
    );
    const cookies = createAuthApp({
      config: runtime.auth.options as never,
      auth: {
        async handler() {
          const headers = new Headers();
          headers.append("Set-Cookie", "one=1; Path=/");
          headers.append("Set-Cookie", "two=2; Path=/");
          return new Response("ok", { headers });
        },
      },
    });
    const parent = new Hono();
    parent.use("*", async (context, next) => {
      context.header("X-Request-ID", "fixture-id");
      context.header("Cache-Control", "no-store");
      await next();
    });
    parent.route(
      "/",
      new URL(request.url).pathname === "/api/auth/fixture-cookies" ? cookies : runtime.app,
    );
    return parent.fetch(request);
  },
};
