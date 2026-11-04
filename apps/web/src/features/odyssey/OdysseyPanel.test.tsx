/** @file OdysseyPanel.test.tsx @description Unlocked method contracts and stateful examples render safely. @module odyssey */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OdysseyPanel } from "./OdysseyPanel";

describe("Odyssey level presentation", () => {
  it("shows the authorized level and void method contract without inserting source", () => {
    const markup = renderToStaticMarkup(
      <OdysseyPanel
        title="Key store"
        progress={{
          level: 1,
          completed: false,
          levels: [
            {
              title: "Store keys",
              statementMarkdown: "Add and read keys.",
              methods: [
                {
                  className: "Solution",
                  methodName: "put",
                  parameters: [{ name: "key", type: "str" }],
                  returnType: "void",
                },
              ],
              examples: [
                { args: [], calls: [{ methodName: "put", args: ["<script>"], expected: null }] },
              ],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain("Key store");
    expect(markup).toContain("Solution.put(key: str) → None");
    expect(markup).not.toContain("All levels complete");
    expect(markup).not.toContain("Unlocked levels");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("textarea");
  });
});
