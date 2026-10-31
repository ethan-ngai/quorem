/** @file workerd.config.ts @description Native Worker execution contract tests. @module execution */
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-03-17" } })],
  test: {
    include: [
      "test/contracts.test.ts",
      "test/manifest-binding.test.ts",
      "test/manifest-checkpoint.test.ts",
    ],
  },
});
