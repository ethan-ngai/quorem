/** @file worker-fixture.ts @description Native authoring integration fixture. @module problems */
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { authoringRoutes } from "../../../../modules/problems/authoring/routes.ts";
import { questionAuthoring, type AuthoringScope } from "./repository.ts";
interface Env {
  AUTHORING_TEST_DATABASE_URL: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(env.AUTHORING_TEST_DATABASE_URL);
    if (
      url.port !== "55447" ||
      url.pathname !== "/quorem_hono_authoring_test" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      return new Response("invalid fixture database", { status: 500 });
    const options = { connectionTimeoutMs: 1000, lifetimeMs: 10000 };
    const run: AuthoringScope = <T>(action: (scope: ConnectionScope) => Promise<T>) =>
      withWorkerConnection(url.toString(), options, action);
    const runtime = (language: string) =>
      language === "python"
        ? { revision: "python-3.12-v1", harness: "quorem-harness-v2" }
        : undefined;
    const app = createApp({ allowedOrigins: [], requestId: () => "workerd-authoring" }).route(
      "/",
      authoringRoutes({
        identify: async () =>
          withWorkerConnection(url.toString(), options, (scope) =>
            developmentIdentity(scope, "quorem-author-worker"),
          ),
        authoring: questionAuthoring(run, runtime),
        allowLocalStrongBypass: false,
        now: () => Math.floor(Date.now() / 1000),
      }),
    );
    return app.fetch(request);
  },
};
