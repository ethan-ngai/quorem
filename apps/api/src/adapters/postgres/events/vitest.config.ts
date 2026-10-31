import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/events/dispatch.test.ts"] },
});
