/** @file vitest.config.ts @description Disposable party PostgreSQL tests. @module parties */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/adapters/postgres/parties/integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
