import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/judging/admission/worker-fixture.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { ADMISSION_DATABASE_URL: process.env.QUOREM_ADMISSION_TEST_DATABASE_URL ?? "" },
        durableObjects: { RECOVERY: "ExecutionRecoveryFixture" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/judging/admission/worker.test.ts"] },
});
