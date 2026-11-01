import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { INPUT_TEST_URL: process.env.QUOREM_INPUT_ADMISSION_TEST_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/judging/admission/inputs.worker.ts"] },
});
