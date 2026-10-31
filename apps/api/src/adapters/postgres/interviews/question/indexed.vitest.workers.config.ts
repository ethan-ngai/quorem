import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { DATABASE: process.env.QUOREM_INTERVIEW_INPUTS_TEST_URL ?? "" },
      },
    }),
  ],
  test: {
    include: ["src/adapters/postgres/interviews/question/indexed.worker.test.ts"],
    testTimeout: 240000,
  },
});
