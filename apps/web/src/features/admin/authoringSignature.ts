import {
  isGraphReturn,
  mergeGraphOutput,
  primarySignature,
  projectCaseGraphs,
} from "@quorem/questions";
import type { QuestionContent, Signature } from "@quorem/contracts";
import { createCustomDraft, parseCustomDraft } from "../editor/customCases";
export function adaptSignature(content: QuestionContent, signature: Signature): QuestionContent {
  const previous = primarySignature(content.problem);
  // Renaming a parameter keeps its graph binding at the same position.
  const newNames = new Set(signature.parameters.map(({ name }) => name));
  const names = new Map(
    previous.parameters.map(({ name }, index) => [
      name,
      newNames.has(name)
        ? name
        : previous.parameters.length === signature.parameters.length
          ? signature.parameters[index]?.name
          : undefined,
    ]),
  );
  const oldPositions = new Map(
    previous.parameters.map(({ name }, index) => [names.get(name), index]),
  );
  const targetName = (name: string) => (isGraphReturn(name) ? name : names.get(name));
  if (signature.graphEncodings === previous.graphEncodings && signature.graphEncodings) {
    signature = {
      ...signature,
      graphEncodings: Object.fromEntries(
        Object.entries(signature.graphEncodings).flatMap(([name, encoding]) => {
          const target = targetName(name);
          if (target === undefined) return [];
          const countParameter = encoding.countParameter
            ? names.get(encoding.countParameter)
            : undefined;
          return [
            [target, { ...encoding, ...(encoding.countParameter ? { countParameter } : {}) }],
          ];
        }),
      ),
    };
  }
  const defaults = parseCustomDraft(
    {
      ...createCustomDraft({ ...content.problem, signature, examples: [] }),
      expectedEnabled: true,
    },
    signature,
  );
  function adapt<T extends QuestionContent["hiddenCases"][number]>(test: T): T {
    const graphs = Object.fromEntries(
      Object.entries(test.graphs ?? {}).flatMap(([name, graph]) => {
        const target = targetName(name);
        if (target === undefined || !Object.hasOwn(signature.graphEncodings ?? {}, target))
          return [];
        const direction = signature.graphEncodings![target]!.directed;
        // Re-infer direction changes from the concrete case to preserve matrix and neighbor values.
        if (
          direction !== undefined &&
          direction !== previous.graphEncodings?.[name]?.directed &&
          direction !== graph.directed
        ) {
          if (signature.graphEncodings![target]!.kind === "edgeList")
            return [[target, { ...graph, directed: direction }]];
          return [];
        }
        return [[target, graph]];
      }),
    );
    const next: QuestionContent["hiddenCases"][number] = {
      ...test,
      args: signature.parameters.map((parameter, index) => {
        const prior =
          previous.graphEncodings || signature.graphEncodings
            ? (oldPositions.get(parameter.name) ?? -1)
            : index;
        return parameter.type === previous.parameters[prior]?.type
          ? (test.args[prior] ?? defaults.args[index]!)
          : defaults.args[index]!;
      }),
      expected: signature.returnType === previous.returnType ? test.expected : defaults.expected,
      graphs: Object.keys(graphs).length ? graphs : undefined,
    };
    try {
      const generated = projectCaseGraphs(
        signature,
        graphs,
        content.problem.limits.maxCollectionElements,
      );
      for (const [index, value] of generated.args) next.args[index] = value;
      next.expected = mergeGraphOutput(generated, next.expected, (_, value) => value);
    } catch {
      // Keep the authored graph available for repair in Tests.
    }
    return { ...test, ...next };
  }
  return {
    ...content,
    problem: {
      ...content.problem,
      signature,
      examples: content.problem.examples.map(adapt),
    },
    hiddenCases: content.hiddenCases.map(adapt),
  };
}
