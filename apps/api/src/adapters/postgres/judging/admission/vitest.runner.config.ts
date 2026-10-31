import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/adapters/postgres/judging/admission/runner.integration.test.ts"],
  },
});
