/** @file public-projection.test.ts @description Stage projection preserves interface flags while removing private fields. @module problems */
import { expect, it } from "vitest";
import { restorePublicExamples } from "./public-projection.ts";
it("strips private stage state while retaining node-reference interface semantics", () => {
  const value = {
    odyssey: {
      levels: [
        {
          title: "Step",
          statementMarkdown: "Work",
          methods: [
            {
              className: "Solution",
              methodName: "node",
              parameters: [{ name: "head", type: "ListNode" }],
              returnType: "ListNode",
              nodeReferences: "return",
              referenceSource: "PRIVATE_CODE",
            },
          ],
          examples: [],
          hiddenCases: [{ args: ["PRIVATE_INPUT"] }],
          internalNotes: "PRIVATE_NOTES",
        },
      ],
    },
  };
  restorePublicExamples(value, null);
  expect(JSON.stringify(value)).not.toContain("PRIVATE");
  expect(value.odyssey.levels[0].methods[0].nodeReferences).toBe("return");
});
