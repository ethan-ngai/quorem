/** @file vite.config.ts @description Shared workspace checks. @module tooling */
import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/generated.ts", "**/.astro/**", "tools/migration-runtime/**"],
  },
  fmt: {
    ignorePatterns: [
      "**/generated.ts",
      "packages/questions/src/draft-validator.mjs",
      "packages/questions/src/question-validator.mjs",
      "pnpm-lock.yaml",
      "docs/plans/**",
      "README.md",
      "DESIGN.md",
    ],
  },
});
