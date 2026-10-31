import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/runtime/composition/budget.test.ts",
      "src/runtime/composition/node.integration.test.ts",
    ],
  },
});
