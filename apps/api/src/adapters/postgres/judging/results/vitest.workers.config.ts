import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { RESULTS_TEST_URL: process.env.QUOREM_RESULTS_TEST_DATABASE_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/judging/results/worker.ts"] },
});
