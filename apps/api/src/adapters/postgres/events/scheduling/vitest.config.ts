import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/events/scheduling/scheduling.test.ts"] },
});
