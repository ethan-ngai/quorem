// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { QuestionContent } from "@quorem/contracts";
import type { CustomCaseDraft } from "../editor/customCases";

const captures = vi.hoisted(() => ({ props: undefined as any }));
vi.mock("../editor/components/TestCases", () => ({
  TestCases: (props: unknown) => {
    captures.props = props;
    return null;
  },
}));
import { AuthoringCases } from "./AuthoringCases";
import { blankQuestion } from "./content";

it("retains incompatible values and blocks unrelated case changes until repaired", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  const validity = vi.fn();
  const content = {
    problem: {
      signature: { parameters: [{ name: "n", type: "int" }], returnType: "int" },
      examples: [
        { args: ["wrong"], expected: 1 },
        { args: [2], expected: 2 },
      ],
    },
    hiddenCases: [],
  } as unknown as QuestionContent;
  await act(async () =>
    root.render(
      <AuthoringCases content={content} onChange={onChange} onValidityChange={validity} />,
    ),
  );
  const drafts = captures.props.drafts as CustomCaseDraft[];
  expect(drafts[0]!.args[0]).toBe('"wrong"');
  expect(
    validity.mock.calls.some((call) => call[1] && JSON.stringify(call[2]).includes("incompatible")),
  ).toBe(true);
  await act(async () => captures.props.onDraftsChange([drafts[0], { ...drafts[1], args: ["3"] }]));
  expect(onChange).not.toHaveBeenCalled();
  const revised = captures.props.drafts as CustomCaseDraft[];
  await act(async () =>
    captures.props.onDraftsChange([{ ...revised[0], args: ["4"] }, revised[1]]),
  );
  expect(
    onChange.mock.calls[0]![0].problem.examples.map((item: { args: unknown[] }) => item.args),
  ).toEqual([[4], [3]]);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps unfinished concrete output when editing a case with a generated return slot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const onChange = vi.fn();
  const content = blankQuestion();
  content.problem.signature = {
    className: "Solution",
    methodName: "solve",
    parameters: [{ name: "n", type: "int" }],
    returnType: "list<list<list<int>>>",
    graphEncodings: { "$return[0]": { kind: "edgeList", directed: true } },
  };
  content.problem.examples = [
    {
      args: [1],
      expected: [[[0, 1]], [[2, 3]]],
    },
  ];
  try {
    await act(async () =>
      root.render(
        <AuthoringCases content={content} onChange={onChange} onValidityChange={() => {}} />,
      ),
    );
    const [original] = captures.props.drafts as CustomCaseDraft[];
    await act(async () => captures.props.onDraftsChange([{ ...original, expected: "[[" }]));
    const [incomplete] = captures.props.drafts as CustomCaseDraft[];
    await act(async () => captures.props.onDraftsChange([{ ...incomplete, args: ["2"] }]));
    expect(captures.props.drafts[0].expected).toBe("[[");
    expect(onChange).not.toHaveBeenCalled();

    const [draft] = captures.props.drafts as CustomCaseDraft[];
    await act(async () =>
      captures.props.onDraftsChange([{ ...draft, expected: "[[[0,1]],[[4,5]]]" }]),
    );
    expect(onChange.mock.calls[0]?.[0].problem.examples[0]).toMatchObject({
      args: [2],
      expected: [[[0, 1]], [[4, 5]]],
    });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
