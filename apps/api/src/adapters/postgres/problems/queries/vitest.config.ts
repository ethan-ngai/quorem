import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/modules/problems/routes.test.ts",
      "src/adapters/postgres/problems/queries/repository.test.ts",
    ],
  },
});
