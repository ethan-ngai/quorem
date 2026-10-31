/** @file workerd.config.ts @description Native Worker codec smoke test. @module questions */
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-03-17" } })],
  test: {
    include: [
      "test/workerd-smoke.ts",
      "src/streaming-json.test.ts",
      "src/signature-stream.test.ts",
    ],
  },
});
