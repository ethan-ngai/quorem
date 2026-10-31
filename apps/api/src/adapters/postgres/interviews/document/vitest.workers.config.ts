import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          INTERVIEW_DOCUMENT_URL: process.env.QUOREM_INTERVIEW_DOCUMENT_TEST_URL ?? "",
        },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/interviews/document/worker.test.ts"] },
});
