import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/interviews/execution/repository.test.ts"] },
});
