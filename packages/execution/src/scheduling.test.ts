import { expect, it } from "vitest";
import { CASE_LANES, judgingCapacity } from "./scheduling.ts";
it("bounds submission slots, case lanes and fairness slices", () => {
  expect(judgingCapacity({})).toEqual({ slots: 8, caseLanes: CASE_LANES, sliceMs: 2000 });
  expect(
    judgingCapacity({ JUDGING_SLOTS: "2", JUDGING_CASE_LANES: "1", JUDGING_SLICE_MS: "1000" }),
  ).toEqual({ slots: 2, caseLanes: 1, sliceMs: 1000 });
  for (const [name, values] of Object.entries({
    JUDGING_SLOTS: ["0", "9", "1.1", " 8"],
    JUDGING_CASE_LANES: ["0", "21", "-1"],
    JUDGING_SLICE_MS: ["0", "50001", "Infinity"],
  }))
    for (const value of values)
      expect(() => judgingCapacity({ [name]: value })).toThrow(`Invalid ${name}`);
});
