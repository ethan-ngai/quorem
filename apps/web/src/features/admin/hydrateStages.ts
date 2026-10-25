import { randomUUID } from "../../randomUUID";
import type { CustomCase, QuestionContent } from "@quorem/contracts";
import { formatTypedField } from "../editor/customCases";
import {
  methodDraft,
  type MethodDraft,
  type SequenceDraft,
  type StageDraft,
} from "../odyssey/stageDrafts";

/** Restore persisted calls by method name; stable draft IDs survive subsequent renames. */
export function hydrateStages(content: QuestionContent): StageDraft[] {
  const available = new Map<string, MethodDraft>();
  return (content.problem.odyssey?.levels ?? []).map((level, index) => {
    const methods = level.methods.map(methodDraft);
    methods.forEach((method) => available.set(method.signature.methodName, method));
    const sequence = (test: CustomCase): SequenceDraft => ({
      id: randomUUID(),
      explanation:
        "explanation" in test && typeof test.explanation === "string"
          ? test.explanation
          : undefined,
      calls: (test.calls ?? []).map((call) => {
        const method = available.get(call.methodName);
        if (!method)
          return {
            id: randomUUID(),
            methodId: `unavailable:${call.methodName}`,
            values: {
              id: randomUUID(),
              expectedEnabled: true,
              args: call.args.map((value) => JSON.stringify(value)),
              expected: JSON.stringify(call.expected ?? null),
            },
          };
        return {
          id: randomUUID(),
          methodId: method.id,
          values: {
            id: randomUUID(),
            expectedEnabled: true,
            args: method.signature.parameters.map((parameter, i) =>
              formatTypedField(parameter.type, call.args[i]!, parameter.input),
            ),
            expected:
              method.signature.returnType === "void"
                ? "null"
                : formatTypedField(method.signature.returnType, call.expected ?? null),
          },
        };
      }),
    });
    return {
      id: randomUUID(),
      title: level.title,
      statement: level.statementMarkdown,
      methods,
      examples: level.examples.map(sequence),
      tests: (content.odysseyHiddenCases?.[index] ?? []).map(sequence),
    };
  });
}
