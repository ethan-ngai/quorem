import type { QuestionContent, Signature } from "@quorem/contracts";
import { createCustomDraft, parseCustomDraft } from "../editor/customCases";
export function adaptSignature(content: QuestionContent, signature: Signature): QuestionContent {
  const previous = content.problem.signature;
  const defaults = parseCustomDraft(
    {
      ...createCustomDraft({ ...content.problem, signature, examples: [] }),
      expectedEnabled: true,
    },
    signature,
  );
  function adapt<T extends QuestionContent["hiddenCases"][number]>(test: T): T {
    return {
      ...test,
      args: signature.parameters.map((parameter, index) =>
        parameter.type === previous.parameters[index]?.type
          ? (test.args[index] ?? defaults.args[index]!)
          : defaults.args[index]!,
      ),
      expected: signature.returnType === previous.returnType ? test.expected : defaults.expected,
    };
  }
  return {
    ...content,
    problem: { ...content.problem, signature, examples: content.problem.examples.map(adapt) },
    hiddenCases: content.hiddenCases.map(adapt),
  };
}
