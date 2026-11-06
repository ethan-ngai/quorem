import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/cli/cli.test.ts",
      "src/adapters/postgres/problems/state-migration.test.ts",
      "src/adapters/postgres/problems/canonical-migration.test.ts",
      "src/adapters/postgres/problems/approaches-migration.test.ts",
    ],
  },
});
