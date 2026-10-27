import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ProblemVersion } from "@quorem/contracts";
import { SqlCaseEditor } from "./SqlCaseEditor";

it("renders editable schema-driven input and expected tables", () => {
  const problem = {
    sql: {
      dialect: "postgresql",
      outputOrder: "unordered",
      tables: [
        {
          name: "items",
          columns: [
            { name: "id", type: "integer" },
            { name: "name", type: "text" },
          ],
        },
      ],
      output: [{ name: "id", type: "integer" }],
    },
  } as unknown as ProblemVersion;
  const html = renderToStaticMarkup(
    <SqlCaseEditor
      problem={problem}
      input={JSON.stringify({ tables: [{ name: "items", rows: [[1, null]] }] })}
      expected={JSON.stringify({ rows: [[1]] })}
      onInputChange={() => {}}
      onExpectedChange={() => {}}
    />,
  );
  expect(html).toContain('aria-label="items row 1 id"');
  expect(html).toContain('aria-label="Set value for items row 1 name"');
  expect(html).toContain('aria-label="Expected output row 1 id"');
  expect(html).toContain('aria-label="Remove items row 1"');
  expect(html).not.toContain("<textarea");
});
