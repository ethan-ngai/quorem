import {
  graphPresetType,
  inferCaseGraph,
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
  const limit = content.problem.limits.maxCollectionElements;
  const encodings = signature.graphEncodings ?? {};
  const presetReturn = Object.entries(encodings).some(
    ([name, { kind }]) => isGraphReturn(name) && graphPresetType(kind),
  );
  function adapt<T extends QuestionContent["hiddenCases"][number]>(test: T): T {
    const graphs = Object.fromEntries(
      Object.entries(previous.graphEncodings ?? {}).flatMap(([name, oldEncoding]) => {
        const target = targetName(name);
        const encoding = target === undefined ? undefined : encodings[target];
        if (target === undefined || !encoding) return [];
        const changedRepresentation = oldEncoding.kind !== encoding.kind;
        const graph =
          test.graphs?.[name] ??
          (changedRepresentation
            ? inferCaseGraph(previous, name, test.args, test.expected, limit)
            : undefined);
        if (!graph) return [];
        const direction = encoding.kind === "successor" ? true : encoding.directed;
        if (
          direction !== undefined &&
          direction !== oldEncoding.directed &&
          direction !== graph.directed
        ) {
          // Re-infer unchanged adjacency presets to preserve their concrete ordering.
          if (
            !changedRepresentation &&
            (encoding.kind === "adjacencyList" || encoding.kind === "adjacencyMatrix") &&
            graph.nodes.every((node) => typeof node !== "object")
          )
            return [];
          return [[target, { ...graph, directed: direction }]];
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
        const encoding = encodings[parameter.name];
        return parameter.type === previous.parameters[prior]?.type ||
          (encoding && graphPresetType(encoding.kind))
          ? (test.args[prior] ?? defaults.args[index]!)
          : defaults.args[index]!;
      }),
      expected:
        signature.returnType === previous.returnType || presetReturn
          ? test.expected
          : defaults.expected,
      graphs: Object.keys(graphs).length ? graphs : undefined,
    };
    try {
      const generated = projectCaseGraphs(signature, graphs, limit);
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
