/** @file graphForm.test.ts @description Preserve arbitrary payloads independently of graph IDs. @module admin */
import { expect, it } from "vitest";
import type { GraphEncoding, QuestionGraph } from "@quorem/questions";
import { graphFromForm, graphToForm } from "./graphForm";

it("round-trips named IDs, duplicate node values and structured edge values", () => {
  const encoding: GraphEncoding = { kind: "custom" };
  const graph: QuestionGraph = {
    directed: true,
    nodes: [{ id: "A, B", value: "true" }, { id: "B", value: "true" }, "3", 3],
    edges: [
      { from: "A, B", to: "B", value: { available: false, cost: [null, 2] } },
      { from: "3", to: 3, value: "" },
    ],
  };
  expect(graphFromForm(graphToForm(graph, encoding), encoding, 100)).toEqual(graph);
});

it("keeps untyped node values until their node is removed", () => {
  const encoding: GraphEncoding = { kind: "custom" };
  const graph: QuestionGraph = {
    directed: true,
    nodes: [
      { id: "A", value: 1 },
      { id: "B", value: 2 },
    ],
    edges: [],
  };
  const form = graphToForm(graph, encoding);
  expect(graphFromForm({ ...form, nodes: "A" }, encoding, 100)).toEqual({
    ...graph,
    nodes: [{ id: "A", value: 1 }],
  });
});
