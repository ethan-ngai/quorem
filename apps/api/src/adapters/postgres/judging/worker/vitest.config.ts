import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/adapters/postgres/judging/worker/*.test.ts"],
    exclude: ["**/*.worker.test.ts"],
  },
});
