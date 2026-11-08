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
