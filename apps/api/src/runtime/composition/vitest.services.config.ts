import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "../../deploy/hono/services/worker.js",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          TEST_CASES: "CaseSandbox",
          TEST_RUNNERS: "RunnerService",
          CASES: "CaseSandbox",
          CASE_CONTROL: "CaseControl",
          RUNNER_CONTROL: "RunnerReleaseControl",
        },
        bindings: { CASE_DIAGNOSTICS: "true" },
      },
    }),
  ],
  test: { include: ["src/runtime/composition/services.workerd.test.ts"] },
});
