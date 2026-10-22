import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration suites share one disposable auth schema and run DDL migrations.
    fileParallelism: false,
  },
});
