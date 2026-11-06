/** @file vitest.config.ts @description Result stream primitive tests. @module judging */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/judging/results/array-stream.test.ts"] },
});
