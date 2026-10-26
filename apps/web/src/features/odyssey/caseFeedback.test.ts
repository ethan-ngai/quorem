/** @file caseFeedback.test.ts @description Verified stage feedback survives pending jobs without fabricating passes. @module odyssey */
import { describe, it, expect } from "vitest";
import type { OdysseyProgress, Submission } from "@quorem/contracts";
import { passedCaseLevels } from "./caseFeedback";
const progress: OdysseyProgress = {
  level: 2,
  completed: false,
  levels: [1, 2].map((n) => ({
    title: `Step ${n}`,
    statementMarkdown: "",
    methods: [],
    examples: [{ args: [n], expected: n }],
  })),
};
const running = { id: "new", state: "running" } as Submission;
describe("evaluated stage feedback", () => {
  it("retains an earlier pass while a new execution is pending", () => {
    expect(
      passedCaseLevels({ ...progress, caseStatuses: [{ index: 0, status: "accepted" }] }, running),
    ).toEqual([1]);
  });
  it("does not infer passes from manual advancement or completion", () => {
    expect(passedCaseLevels({ ...progress, completed: true })).toEqual([]);
  });
  it("keeps a passing earlier stage when a later stage fails", () => {
    expect(
      passedCaseLevels(progress, {
        ...running,
        state: "completed",
        verdict: "wrong_answer",
        publicCases: [
          { index: 0, status: "accepted" },
          { index: 1, status: "wrong_answer" },
        ],
      }),
    ).toEqual([1]);
  });
  it("replaces historical passes with actually evaluated regressions", () => {
    expect(
      passedCaseLevels(
        { ...progress, caseStatuses: [{ index: 0, status: "accepted" }] },
        { ...running, state: "completed", publicCases: [{ index: 0, status: "wrong_answer" }] },
      ),
    ).toEqual([]);
  });
});
