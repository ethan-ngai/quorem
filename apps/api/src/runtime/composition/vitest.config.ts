import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "src/runtime/composition/budget.test.ts",
      "src/runtime/composition/config.test.ts",
      "src/runtime/composition/recovery.test.ts",
      "src/runtime/composition/wake-consumer.test.ts",
      "src/runtime/composition/node.integration.test.ts",
      "src/runtime/composition/node.lifecycle.test.ts",
      "src/runtime/composition/node.peer.test.ts",
      "src/runtime/composition/node.e2e.test.ts",
    ],
  },
});
