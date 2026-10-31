import { workerRuntime, type AuthWorkerEnv } from "./worker.ts";
export default {
  fetch(request: Request, env: AuthWorkerEnv) {
    return workerRuntime(
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
    ).app.fetch(request);
  },
};
