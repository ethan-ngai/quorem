/** @file vite.config.ts @description Shared workspace checks. @module tooling */
import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/generated.ts"],
  },
  fmt: {
    ignorePatterns: [
      "**/generated.ts",
      "pnpm-lock.yaml",
      "docs/plans/**",
      "README.md",
      "DESIGN.md",
    ],
  },
});
