/** @file ranking.test.ts @description Learning, decay and competitive fairness invariants. @module problems */
import { expect, it } from "vitest";
import { rankPractice, matchRecommendationPool, type RecommendationContext } from "./ranking.ts";
import {
  day,
  prior,
  learner,
  observe,
  features,
  recall,
  validPredictor,
  type LearningQuestion,
  type LearningEvent,
} from "./model.ts";
const now = Date.UTC(2026, 10, 6);
const question = (id: string, difficulty = "easy", tags = ["arrays"]): LearningQuestion => ({
  id,
  key: id,
  difficulty,
  tags,
});
const event = (
  id: string,
  accepted = false,
  at = now - 10 * day,
  owner = "alice",
): LearningEvent => ({
  ...question(id),
  eventId: id + at,
  owner,
  at,
  accepted,
  context: "practice",
});
const context = (
  events: LearningEvent[] = [],
  seen: { id: string; owner: string }[] = [],
): RecommendationContext => ({
  events,
  model: prior(),
  exposures: seen.map((e) => ({ ...e, lastSeen: now })),
});
it("cold start favors approachable questions with stable, diverse prefix pagination", () => {
  const qs = [
    question("hard", "hard"),
    question("a"),
    question("b"),
    question("c", "easy", ["graphs"]),
  ];
  const rows = rankPractice(qs, context(), now);
  expect(rows[0].question.id).toBe("a");
  expect(rows[1].question.id).toBe("c");
  expect(rows).toEqual(rankPractice([...qs].reverse(), context(), now));
  expect(rows.slice(0, 2)).toEqual(rankPractice(qs, context(), now, 2));
});
it("recent repeats fall below fresh questions and overdue solves return", () => {
  const qs = [question("fresh"), question("seen")];
  expect(rankPractice(qs, context([], [{ id: "seen", owner: "alice" }]), now)[0].question.id).toBe(
    "fresh",
  );
  expect(rankPractice(qs, context([event("seen", true, now - 30 * day)]), now)[0]).toMatchObject({
    question: { id: "seen" },
    reason: "review",
  });
});
it("outcomes transfer across topics and semantic vectors; retries do not inflate skill", () => {
  const state = learner(),
    model = prior();
  const seen = { ...event("seen", true, now), embedding: [1, 0] };
  observe(state, seen, model);
  const before = features(
    state,
    { ...question("other"), embedding: [1, 0] },
    model,
    now,
    "practice",
  );
  const unrelated = features(
    state,
    { ...question("other", "easy", ["graphs"]), embedding: [0, 1] },
    model,
    now,
    "practice",
  );
  expect(before[3]).toBeGreaterThan(unrelated[3]);
  expect(before[4]).toBeGreaterThan(unrelated[4]);
  expect(observe(state, { ...seen, eventId: "retry" }, model).first).toBe(false);
  expect(
    features(state, { ...question("other"), embedding: [1, 0] }, model, now, "practice"),
  ).toEqual(before);
  const faded = features(
    state,
    { ...question("other"), embedding: [1, 0] },
    model,
    now + model.skillHalfLife * day,
    "practice",
  );
  expect(faded[2]).toBeCloseTo(before[2] / 2);
  expect(faded[3]).toBeCloseTo(before[3] / 2);
  expect(faded[4]).toBeCloseTo(before[4] / 2);
  expect(recall(state, seen, model, now + model.recallHalfLife * day)).toBeCloseTo(0.5);
  observe(state, { ...seen, accepted: false, at: now + day }, model);
  expect(recall(state, seen, model, now + day)).toBe(0);
});
it("trained coefficients affect predictions and malformed models are rejected", () => {
  const ctx = context();
  ctx.model.weights[0] = 3;
  expect(rankPractice([question("q")], ctx, now)[0].probability).toBeGreaterThan(
    rankPractice([question("q")], context(), now)[0].probability,
  );
  expect(validPredictor(prior())).toBe(true);
  expect(validPredictor({ ...prior(), skillHalfLife: "30" })).toBe(false);
  expect(validPredictor({ ...prior(), weights: [NaN] })).toBe(false);
});
it("matches consider every seat, preserve fairness and keep small pools playable", () => {
  const qs = [question("seen"), question("fresh")],
    ctx = context([], [{ id: "seen", owner: "bob" }]);
  expect(matchRecommendationPool(qs, ctx, ["alice", "bob"], now)).toEqual(["fresh"]);
  expect(matchRecommendationPool(qs, ctx, ["bob", "alice"], now)).toEqual(["fresh"]);
  expect(matchRecommendationPool([question("seen")], ctx, ["alice", "bob"], now)).toEqual(["seen"]);
  expect(matchRecommendationPool([], ctx, ["alice"], now)).toEqual([]);
  const exhausted = context(
    [],
    [
      { id: "shared", owner: "alice" },
      { id: "shared", owner: "bob" },
      { id: "advantage", owner: "bob" },
    ],
  );
  expect(
    matchRecommendationPool(
      [question("shared"), question("advantage")],
      exhausted,
      ["alice", "bob"],
      now,
    ),
  ).toEqual(["shared"]);
});
