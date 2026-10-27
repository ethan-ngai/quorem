/** @file stageDrafts.test.ts @description Stateful authoring preserves values and rejects future-method references. @module odyssey */
import { describe, it, expect } from "vitest";
import type { Signature } from "@quorem/contracts";
import {
  firstStage,
  methodDraft,
  sequenceDraft,
  callDraft,
  parseStages,
  updateMethod,
} from "./stageDrafts";
const deposit: Signature = {
  className: "Solution",
  methodName: "deposit",
  parameters: [{ name: "amount", type: "int" }],
  returnType: "int",
};
function initial() {
  return { ...firstStage(deposit), statement: "Deposit funds." };
}
describe("typed stage authoring", () => {
  it("serializes cumulative calls, method renames and void expectations", () => {
    const first = initial();
    first.examples[0]!.calls[0]!.values.args = ["5"];
    const clear = methodDraft({
      className: "Solution",
      methodName: "clear",
      parameters: [],
      returnType: "void",
    });
    const second = {
      ...firstStage(clear.signature),
      title: "Clear",
      statement: "Clear the ledger.",
      methods: [clear],
      examples: [{ id: "case", calls: [callDraft(first.methods[0]!), callDraft(clear)] }],
      tests: [sequenceDraft(clear)],
    };
    const renamed = updateMethod([first, second], first.methods[0]!.id, {
      ...deposit,
      methodName: "add",
    });
    const parsed = parseStages(renamed);
    expect(parsed.odyssey.levels[0]!.examples[0]!.calls![0]).toEqual({
      methodName: "add",
      args: [5],
      expected: 0,
    });
    expect(parsed.odyssey.levels[1]!.examples[0]!.calls!.map((call) => call.methodName)).toEqual([
      "add",
      "clear",
    ]);
    expect(parsed.odysseyHiddenCases[1]![0]!.calls![0]!.expected).toBeNull();
  });
  it("preserves method and parameter documentation through editing and serialization", () => {
    const first = initial();
    const documented = {
      ...deposit,
      description: "Add funds.",
      parameters: [{ name: "amount", type: "int", description: "Amount to add." }],
      returns: "The updated balance.",
      throws: [{ type: "ValueError", description: "Invalid amount." }],
    };
    const edited = updateMethod([first], first.methods[0]!.id, documented);
    expect(JSON.parse(JSON.stringify(parseStages(edited))).odyssey.levels[0].methods[0]).toEqual(
      documented,
    );
  });
  it("rejects a later-stage call in an earlier stage", () => {
    const first = initial();
    const future = methodDraft({ ...deposit, methodName: "withdraw" });
    first.examples = [sequenceDraft(future)];
    expect(() => parseStages([first])).toThrow("choose an available method");
  });
  it("retains compatible argument text when names change and resets only a changed type", () => {
    const first = initial();
    first.examples[0]!.calls[0]!.values.args = ["2 + 3"];
    const renamed = updateMethod([first], first.methods[0]!.id, {
      ...deposit,
      parameters: [{ name: "quantity", type: "int" }],
    });
    expect(renamed[0]!.examples[0]!.calls[0]!.values.args).toEqual(["2 + 3"]);
    const changed = updateMethod(renamed, first.methods[0]!.id, {
      ...deposit,
      parameters: [{ name: "quantity", type: "str" }],
    });
    expect(changed[0]!.examples[0]!.calls[0]!.values.args).toEqual([""]);
  });
  it("keeps invalid typed text for correction and blocks submission with a specific error", () => {
    const first = initial();
    first.tests[0]!.calls[0]!.values.expected = "(";
    expect(() => parseStages([first])).toThrow("Step 1, case 1, deposit");
    expect(first.tests[0]!.calls[0]!.values.expected).toBe("(");
  });
});
