/** @file auth-boundaries.test.ts @description Restrict shared auth dependencies to the pure policy leaf. @module api */
import { expect, it } from "vitest";
import { boundaryViolations } from "../check-boundaries.ts";
it("permits shared lifetime policy while rejecting client and schema entrypoints", () => {
  const path = "/api/src/modules/identity/model.ts";
  expect(
    boundaryViolations("/api/src", new Map([[path, "import '@quorem/contracts/auth-policy';"]])),
  ).toEqual([]);
  expect(
    boundaryViolations(
      "/api/src",
      new Map([
        [
          path,
          "import '@quorem/contracts'; import '@quorem/contracts/auth'; import '@quorem/contracts/auth-policy/hidden';",
        ],
      ]),
    ),
  ).toHaveLength(3);
});
