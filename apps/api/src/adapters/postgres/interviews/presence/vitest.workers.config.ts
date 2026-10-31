import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          INTERVIEW_PRESENCE_URL: process.env.QUOREM_INTERVIEW_PRESENCE_TEST_URL ?? "",
        },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/interviews/presence/worker.test.ts"] },
});
