/** @file training.test.ts @description Chronological evaluation and promotion safeguards. @module problems */
import { expect, it } from "vitest";
import { day, prior, validPredictor, type LearningEvent } from "./model.ts";
import { train } from "./training.ts";
const now = Date.UTC(2026, 10, 6);
// Deliberately mislabeled item difficulty: shared item effects must learn the signal.
const events: LearningEvent[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `q${i % 4}`,
  key: `q${i % 4}`,
  eventId: `e${i}`,
  owner: `u${i % 20}`,
  at: now - 100 * day + (i * day) / 10,
  difficulty: "easy",
  tags: ["arrays"],
  accepted: i % 4 === 0,
  context: "practice",
}));
it("learns actual coefficients, validates on later outcomes, and ignores input ordering", () => {
  const result = train(events, prior(), now);
  expect(validPredictor(result.model)).toBe(true);
  expect(result.model.weights).not.toEqual(prior().weights);
  expect(result.metrics.count).toBeGreaterThanOrEqual(40);
  expect(result.metrics.logLoss).toBeLessThan(result.baseline.logLoss);
  expect(result.eligible).toBe(true);
  expect(train([...events].reverse(), prior(), now)).toEqual(result);
});
it("held-out labels never change fitted parameters or tuned decay", () => {
  const original = train(events, prior(), now);
  const changed = train(
    events.map((e) => (e.at >= original.testFrom ? { ...e, accepted: !e.accepted } : e)),
    prior(),
    now,
  );
  expect(changed.model).toEqual(original.model);
  expect(changed.metrics).not.toEqual(original.metrics);
  expect(changed.eligible).toBe(false);
});
it("requires enough independent evidence and a fresh incumbent holdout", () => {
  expect(train(events.slice(0, 20), prior(), now).eligible).toBe(false);
  const incumbent = train(events, prior(), now).model;
  expect(train(events, incumbent, now).eligible).toBe(false);
  const future = { ...events[0], at: now + day };
  expect(train([...events, future], prior(), now)).toEqual(train(events, prior(), now));
  expect(train([], prior(), now).reason).toBe("insufficient_evidence");
});
