/** @file public-projection.test.ts @description Stage projection preserves interface flags while removing private fields. @module problems */
import { expect, it } from "vitest";
import type { JsonValue } from "@quorem/questions";
import { restorePublicExamples } from "./public-projection.ts";
it("strips private stage state while retaining node-reference interface semantics", () => {
  const parameters: Record<string, JsonValue>[] = [
    { name: "head", type: "ListNode" },
    {
      name: "grid",
      type: "list<list<int>>",
      input: { preset: "default", layout: "rows", showGrid: true },
    },
  ];
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
              parameters,
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
  const method = value.odyssey.levels[0].methods[0];
  expect(method.nodeReferences).toBe("return");
  expect(method.parameters[1]?.input).toEqual({
    preset: "default",
    layout: "rows",
    showGrid: true,
  });
});
