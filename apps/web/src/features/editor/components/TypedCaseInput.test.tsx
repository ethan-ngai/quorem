import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TypedCaseInput } from "./TypedCaseInput";
import { TestCases } from "./TestCases";
import type { ProblemVersion } from "@quorem/contracts";

const problem: ProblemVersion = {
  id: "fixture",
  slug: "fixture",
  version: "1",
  title: "Fixture",
  difficulty: "easy",
  tags: [],
  statementMarkdown: "",
  constraints: [],
  examples: [],
  signature: {
    className: "Solution",
    methodName: "solve",
    parameters: [{ name: "values", type: "list<int>" }],
    returnType: "int",
  },
  starterSource: "",
  runtimeRevision: "fixture",
  limits: {
    wallTimeMs: 2000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  },
};

describe("typed case controls", () => {
  it("keeps list delimiters outside the editable content and omits routine hints", () => {
    const markup = renderToStaticMarkup(
      <TypedCaseInput
        id="values"
        name="values"
        type="list<int>"
        value="[1,10 * 3]"
        onChange={() => {}}
      />,
    );
    expect(markup).toContain('value="1,10 * 3"');
    expect(markup.match(/class="collection-delimiter"/g)).toHaveLength(2);
    expect(markup).not.toContain("JSON array");
    expect(markup).not.toContain("-format");
  });
  it("supports multiline question overrides and nullable values", () => {
    const multiline = renderToStaticMarkup(
      <TypedCaseInput
        id="values"
        name="values"
        type="list<int>"
        input={{ preset: "sequence", rows: 3, placeholder: "Enter values" }}
        value="[1,2]"
        onChange={() => {}}
      />,
    );
    expect(multiline).toContain('rows="3"');
    expect(multiline).toContain('placeholder="Enter values"');
    const nullable = renderToStaticMarkup(
      <TypedCaseInput
        id="value"
        name="value"
        type="optional<int>"
        value="null"
        onChange={() => {}}
      />,
    );
    expect(nullable).toContain('aria-label="Set value value"');
    expect(nullable).toContain('class="typed-null"');
    expect(nullable).not.toContain('type="checkbox"');
  });
  it("uses add/remove actions for optional expected output, preserving its input", () => {
    const draft = { id: "case", args: ["[1]"], expectedEnabled: false, expected: "10 * 3" };
    const render = (expectedEnabled: boolean) =>
      renderToStaticMarkup(
        <TestCases
          problem={problem}
          customMode
          drafts={[{ ...draft, expectedEnabled }]}
          onDraftsChange={() => {}}
        />,
      );
    expect(render(false)).toContain("Add expected output");
    expect(render(false)).not.toContain('type="checkbox"');
    expect(render(true)).toContain("Remove expected output");
    expect(render(true)).toContain('value="10 * 3"');
  });
});
