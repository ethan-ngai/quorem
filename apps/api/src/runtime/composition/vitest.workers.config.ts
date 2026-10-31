import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/runtime/worker.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        hyperdrives: {
          DB:
            process.env.QUOREM_RUNTIME_TEST_URL ??
            "postgres://fixture:fixture@127.0.0.1:55575/quorem_hono_runtime_test",
        },
        durableObjects: {
          SOCKETS: "BrowserSockets",
          DEADLINES: "DeadlineCoordinator",
          EXECUTION_RECOVERY: "ExecutionRecovery",
        },
        queueProducers: { EXECUTION_QUEUE: "runtime-test-wakes" },
        bindings: {
          DATABASE_CHECK: process.env.QUOREM_RUNTIME_TEST_URL ?? "",
          APP_ENV: "local",
          AUTH_MODE: "password",
          AUTH_ORIGIN: "http://127.0.0.1:8765",
          BETTER_AUTH_SECRET: "local-runtime-fixture-secret-32-characters",
          AUTH_INTERNAL_SECRET: "local-test-internal",
          ALLOWED_ORIGINS: "http://127.0.0.1:5173",
          MATCH_INVITE_KEY: "ab".repeat(32),
          EXECUTION_WAKE_PROVIDER: "cloudflare-binding",
        },
      },
    }),
  ],
  test: { testTimeout: 30000, include: ["src/runtime/composition/worker.integration.test.ts"] },
});
