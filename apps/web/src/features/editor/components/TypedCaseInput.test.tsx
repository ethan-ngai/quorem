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
  it("frames string and nullable-string content without changing literal data", () => {
    for (const [type, value] of [
      ["str", 'a"b\n雪'],
      ["optional<str>", JSON.stringify("null")],
    ]) {
      const markup = renderToStaticMarkup(
        <TypedCaseInput id="text" name="text" type={type!} value={value!} onChange={() => {}} />,
      );
      expect(markup.match(/class="collection-delimiter"/g)).toHaveLength(2);
      expect(markup).toContain("&quot;</span>");
    }
  });
  it("labels shared boolean controls and preserves false selection", () => {
    const markup = renderToStaticMarkup(
      <TypedCaseInput id="enabled" name="enabled" type="bool" value="false" onChange={() => {}} />,
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="enabled"');
    expect(markup).toContain('id="enabled"');
    expect(markup).toContain(">False</span>");
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
  it("uses one case rail for recovered results without inventing input association", () => {
    const markup = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        submission={{
          id: "run",
          workspaceId: "workspace",
          kind: "run",
          state: "completed",
          sourceHash: "source",
          admittedAt: "2026-10-11T00:00:00Z",
          updatedAt: "2026-10-11T00:00:01Z",
          publicCases: [
            { index: 0, status: "wrong_answer", actual: 90, expected: 18 },
            { index: 1, status: "accepted", actual: 3, expected: 3 },
          ],
        }}
      />,
    );
    expect(markup.match(/class="case-rail"/g)).toHaveLength(1);
    expect(markup).toContain("Case 2");
    expect(markup).toContain(">90</code>");
    expect(markup).toContain(">18</code>");
    expect(markup).not.toContain("No sample cases available");
    expect(markup).not.toContain("parameter-name");
  });
  it("associates explained samples with metadata-free execution snapshots", () => {
    const value = { args: [[1]], expected: 18 };
    const markup = renderToStaticMarkup(
      <TestCases
        problem={{ ...problem, examples: [{ ...value, explanation: "Display only" }] }}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        snapshot={{ problemVersionId: problem.id, custom: false, cases: [{ id: "0", value }] }}
        submission={{
          id: "run",
          workspaceId: "workspace",
          kind: "run",
          state: "completed",
          sourceHash: "source",
          admittedAt: "2026-10-11T00:00:00Z",
          updatedAt: "2026-10-11T00:00:01Z",
          publicCases: [{ index: 0, status: "wrong_answer", actual: 90, expected: 18 }],
        }}
      />,
    );
    expect(markup).toContain(">90</code>");
    expect(markup.match(/>18<\/code>/g)).toHaveLength(1);
  });
  it("keeps hidden-case data private while showing status", () => {
    for (const status of ["accepted", "wrong_answer", "time_limit"] as const) {
      const markup = renderToStaticMarkup(
        <TestCases
          problem={problem}
          customMode={false}
          drafts={[]}
          onDraftsChange={() => {}}
          submission={{
            id: "submit",
            workspaceId: "workspace",
            kind: "submit",
            state: "completed",
            sourceHash: "source",
            admittedAt: "",
            updatedAt: "",
            hiddenCases: [{ index: 0, status }],
          }}
        />,
      );
      expect(markup).toContain('class="case-group-label case-group-label--locked"');
      expect(markup).toContain(
        status === "accepted"
          ? "Hidden case 1: passed"
          : status === "time_limit"
            ? "Hidden case 1: time limit exceeded"
            : "Hidden case 1: failed",
      );
      expect(markup).not.toContain("machine-value");
      expect(markup).not.toContain("case-run-output");
    }
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
