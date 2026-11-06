/** @file training.test.ts @description Chronological evaluation and promotion safeguards. @module problems */
import { expect, it } from "vitest";
import {
  day,
  learner,
  predict,
  prior,
  topicGapFeatureIndex,
  validPredictor,
  type LearningEvent,
} from "./model.ts";
import { train } from "./training.ts";
const now = Date.UTC(2026, 10, 6);
// Deliberately mislabeled item difficulty: shared item effects must learn the signal.
const events: LearningEvent[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `q${i % 4}`,
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
  expect(result.usesTopicGap).toBe(false);
  expect(result.slices.practice.count).toBe(result.metrics.count);
  expect(result.slices.match.count).toBe(0);
  expect(result.slices.newCatalogQuestion.count).toBe(0);
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

it("can distinguish a weak required topic from uniformly average skills", () => {
  const model = prior();
  const state = learner();
  state.at = now;
  state.topics.set("binary search", 1);
  state.topics.set("dynamic programming", -1);
  const mixed = {
    id: "mixed",
    difficulty: "medium",
    tags: ["binary search", "dynamic programming"],
  };
  const average = { ...mixed, tags: ["graphs", "arrays"] };
  expect(predict(state, mixed, model, now, "practice")).toBe(
    predict(state, average, model, now, "practice"),
  );
  model.weights[topicGapFeatureIndex] = 0.5;
  const initial = predict(state, mixed, model, now, "practice");
  expect(initial).toBeLessThan(predict(state, average, model, now, "practice"));
  expect(predict(state, mixed, model, now + model.skillHalfLife * day, "practice")).toBeGreaterThan(
    initial,
  );
  state.topics.set("binary search", 2);
  expect(predict(state, mixed, model, now, "practice")).toBeGreaterThan(initial);
});

it("promotes the weakest-topic feature when later outcomes depend on the weakest skill", () => {
  let seed = 930119;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const sessions: LearningEvent[] = [];
  const skills = [
    [0.92, 0.08],
    [0.52, 0.52],
    [0.92, 0.92],
    [0.08, 0.08],
  ];
  for (let t = 0; t < 120; t++) {
    for (let person = 0; person < 48; person++) {
      const [a, b] = skills[person % skills.length];
      const tags = t < 20 || random() < 0.4 ? [t % 2 ? "a" : "b"] : ["a", "b"];
      const chance = Math.min(...tags.map((tag) => (tag === "a" ? a : b)));
      sessions.push({
        id: `${tags.join("")}-${Math.floor(random() * 10)}`,
        eventId: `${t}-${person}`,
        owner: `u${person}`,
        at: now - (120 - t) * day,
        difficulty: "medium",
        tags,
        accepted: random() < chance,
        context: "practice",
      });
    }
  }
  const result = train(sessions, prior(), now);
  expect(result.usesTopicGap).toBe(true);
  expect(result.model.weights[topicGapFeatureIndex]).toBeGreaterThan(0);
  expect(result.eligible).toBe(true);
  expect(result.metrics.logLoss).toBeLessThan(result.meanTopics.logLoss);
  expect(result.metrics.brier).toBeLessThan(result.meanTopics.brier);
});
