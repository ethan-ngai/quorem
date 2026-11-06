/** @file worker-fixture.ts @description Native authoring integration fixture. @module problems */
import { languageRuntime } from "@quorem/execution";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
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
    assertRunnerFixture(url.toString(), ["/quorem_hono_authoring_test"]);
    const options = { connectionTimeoutMs: 1000, lifetimeMs: 10000 };
    const run: AuthoringScope = <T>(action: (scope: ConnectionScope) => Promise<T>) =>
      withWorkerConnection(url.toString(), options, action);
    const app = createApp({ allowedOrigins: [], requestId: () => "workerd-authoring" }).route(
      "/",
      authoringRoutes({
        identify: async () =>
          withWorkerConnection(url.toString(), options, (scope) =>
            developmentIdentity(scope, "quorem-author-worker"),
          ),
        authoring: questionAuthoring(run, languageRuntime),
        allowLocalStrongBypass: false,
        now: () => Math.floor(Date.now() / 1000),
      }),
    );
    return app.fetch(request);
  },
};
