import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { RUNNER_TEST_URL: process.env.QUOREM_RUNNER_TEST_DATABASE_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/judging/worker/worker.ts"] },
});
