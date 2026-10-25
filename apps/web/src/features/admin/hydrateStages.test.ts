import { expect, it } from "vitest";
import fixture from "../../../../../fixtures/odyssey/balance-ledger.json";
import type { QuestionContent, OdysseyLevel } from "@quorem/contracts";
import { blankQuestion } from "./content";
import { hydrateStages } from "./hydrateStages";
import { parseStages } from "../odyssey/stageDrafts";

it("round-trips saved steps, void calls and earlier methods without losing explanations", () => {
  const content = blankQuestion();
  const data = fixture as unknown as {
    problem: { odyssey: { levels: OdysseyLevel[] } };
    odysseyHiddenCases: QuestionContent["odysseyHiddenCases"];
  };
  content.problem.odyssey = data.problem.odyssey;
  content.odysseyHiddenCases = data.odysseyHiddenCases;
  const drafts = hydrateStages(content);
  const result = parseStages(drafts);
  expect(result.odyssey).toEqual(content.problem.odyssey);
  expect(result.odysseyHiddenCases).toEqual(content.odysseyHiddenCases);
});

it("retains incomplete steps in drafts while publication validation stays strict", () => {
  const content = blankQuestion();
  content.problem.odyssey = {
    levels: [{ title: "", statementMarkdown: "", methods: [], examples: [] }],
  };
  const stages = hydrateStages(content);
  expect(parseStages(stages, { allowIncomplete: true }).odyssey).toEqual(content.problem.odyssey);
  expect(() => parseStages(stages)).toThrow();
});

it("opens incomplete saved calls for correction instead of crashing the page", () => {
  const content = blankQuestion();
  content.problem.odyssey = {
    levels: [
      {
        title: "Step",
        statementMarkdown: "Work",
        methods: [],
        examples: [
          { args: [], expected: null, calls: [{ methodName: "missing", args: [3], expected: 4 }] },
        ],
      },
    ],
  };
  const stages = hydrateStages(content);
  expect(stages[0]!.examples[0]!.calls[0]!.values.args).toEqual(["3"]);
  expect(() => parseStages(stages)).toThrow();
});
