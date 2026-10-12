import type { ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
export const source = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, num in enumerate(nums):
            seen[num] = i
            if target - num in seen:
                return [seen[target - num], i]`;
export const previewProblem: ProblemVersion = {
  id: "preview-two-sum",
  slug: "two-sum",
  version: "1",
  title: "Two Sum",
  difficulty: "easy",
  tags: ["arrays", "hash table"],
  statementMarkdown: "Find the two indices whose values add up to the target.",
  examples: [
    { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { args: [[2, 4, 3], 6], expected: [0, 1] },
    { args: [[3, 3], 6], expected: [0, 1] },
  ],
  constraints: [],
  signature: {
    className: "Solution",
    methodName: "twoSum",
    parameters: [
      { name: "nums", type: "list<int>" },
      { name: "target", type: "int" },
    ],
    returnType: "list<int>",
  },
  starterSource: source,
  runtimeRevision: "preview",
  limits: {
    wallTimeMs: 1000,
    memoryBytes: 134217728,
    outputBytes: 1024,
    maxProcesses: 1,
    maxCollectionElements: 10000,
    maxNestingDepth: 20,
  },
};
const results: PublicCaseResult[] = [
  { index: 0, status: "accepted", actual: [0, 1], expected: [0, 1] },
  { index: 1, status: "accepted", actual: [0, 1], expected: [0, 1] },
  { index: 2, status: "wrong_answer", actual: [0, 0], expected: [0, 1] },
];
/** Deterministic examples drive the real result components without judge requests. */
export function previewSubmission(stage: number): Submission | undefined {
  return stage === 0
    ? undefined
    : {
        id: "preview-run",
        workspaceId: "preview",
        kind: "run",
        state: stage >= 2 ? "completed" : "running",
        sourceHash: "preview",
        admittedAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:01Z",
        verdict: stage >= 2 ? "wrong_answer" : undefined,
        publicCases: stage >= 2 ? results : undefined,
      };
}
export const previewSnapshot = {
  problemVersionId: previewProblem.id,
  custom: false,
  cases: previewProblem.examples.map((example, i) => ({
    id: String(i),
    value: { args: example.args, expected: example.expected },
  })),
};
