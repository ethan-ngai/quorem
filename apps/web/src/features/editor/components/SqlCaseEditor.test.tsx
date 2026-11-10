// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PublishedQuestion } from "@quorem/contracts";
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
  } as unknown as PublishedQuestion;
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

it("syncs changed row widths only after an explicit action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const inputChanged = vi.fn();
  const outputChanged = vi.fn();
  const problem = {
    sql: {
      tables: [
        {
          name: "items",
          columns: [
            { name: "id", type: "bigint" },
            { name: "name", type: "text" },
          ],
        },
      ],
      output: [{ name: "id", type: "bigint" }],
    },
  } as unknown as PublishedQuestion;
  await act(async () =>
    root.render(
      <SqlCaseEditor
        problem={problem}
        input={JSON.stringify({ tables: [{ name: "items", rows: [["9007199254740993"]] }] })}
        expected={JSON.stringify({ rows: [["9007199254740993", "extra"]] })}
        onInputChange={inputChanged}
        onExpectedChange={outputChanged}
      />,
    ),
  );
  const buttons = [...host.querySelectorAll("button")];
  expect(host.textContent).toContain("removes extra cells");
  expect(inputChanged).not.toHaveBeenCalled();
  await act(async () =>
    buttons.find((button) => button.textContent?.includes("Sync input tables"))!.click(),
  );
  await act(async () =>
    buttons.find((button) => button.textContent?.includes("Sync expected output"))!.click(),
  );
  expect(JSON.parse(inputChanged.mock.calls[0]![0]).tables[0].rows).toEqual([
    ["9007199254740993", ""],
  ]);
  expect(JSON.parse(outputChanged.mock.calls[0]![0]).rows).toEqual([["9007199254740993"]]);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
