import { expect, it } from "vitest";
import { adaptSignature } from "./authoringSignature";
import { blankQuestion } from "./content";
it("adapts public and private case arity before shared test controls receive a signature", () => {
  const content = blankQuestion();
  content.problem.examples = [{ args: [], expected: 1, explanation: "Keep explanation" }];
  content.hiddenCases = [{ args: [], expected: 1 }];
  const signature = { ...content.problem.signature, parameters: [{ name: "n", type: "int" }] };
  const next = adaptSignature(content, signature);
  expect(next.problem.examples[0]).toEqual({
    args: [0],
    expected: 1,
    explanation: "Keep explanation",
  });
  expect(next.hiddenCases[0]?.args).toEqual([0]);
  const renamed = adaptSignature(next, {
    ...signature,
    methodName: "renamed",
    parameters: [{ name: "renamed", type: "int" }],
  });
  expect(renamed.problem.examples).toEqual(next.problem.examples);
});
