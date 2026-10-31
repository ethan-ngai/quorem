import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/interviews/question/indexed.test.ts"] },
});
