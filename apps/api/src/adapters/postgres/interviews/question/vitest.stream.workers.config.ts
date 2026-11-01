import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          INTERVIEW_QUESTIONS_URL: process.env.QUOREM_INTERVIEW_QUESTIONS_TEST_URL ?? "",
        },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/interviews/question/stream.worker.test.ts"] },
});
