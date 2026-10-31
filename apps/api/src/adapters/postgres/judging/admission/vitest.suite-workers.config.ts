import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { SUITE_DATABASE_URL: process.env.QUOREM_SUITE_TEST_DATABASE_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/judging/admission/suite-manifests.worker.ts"] },
});
