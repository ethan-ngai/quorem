/** @file ranking.test.ts @description Learning, decay and competitive fairness invariants. @module problems */
import { expect, it } from "vitest";
import {
  rankPractice,
  matchRecommendationCandidates,
  matchTechniquePool,
  type RecommendationContext,
} from "./ranking.ts";
import type { MatchTopicPolicy } from "./match-curriculum.ts";
import {
  day,
  prior,
  learner,
  observe,
  features,
  reviewStrength,
  validPredictor,
  type LearningQuestion,
  type LearningEvent,
} from "./model.ts";
const matchRecommendationPool = (...args: Parameters<typeof matchRecommendationCandidates>) =>
  matchRecommendationCandidates(...args).map((row) => row.id);
const now = Date.UTC(2026, 10, 6);
const question = (id: string, difficulty = "easy", tags = ["arrays"]): LearningQuestion => ({
  id,
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
it("outcomes transfer across topics; assistance and retry effort reduce skill credit", () => {
  const state = learner(),
    model = prior();
  const seen = event("seen", true, now);
  observe(state, seen, model);
  const before = features(state, question("other"), model, now, "practice");
  const unrelated = features(state, question("other", "easy", ["graphs"]), model, now, "practice");
  expect(before[3]).toBeGreaterThan(unrelated[3]);
  const retried = learner(),
    assisted = learner();
  observe(retried, { ...seen, attempts: 4 }, model);
  observe(assisted, { ...seen, assisted: true }, model);
  expect(retried.ability).toBeGreaterThan(assisted.ability);
  expect(retried.ability).toBeLessThan(state.ability);
  expect(reviewStrength(assisted, seen, model, now)).toBe(0);
  const faded = features(
    state,
    question("other"),
    model,
    now + model.skillHalfLife * day,
    "practice",
  );
  expect(faded[2]).toBeCloseTo(before[2] / 2);
  expect(faded[3]).toBeCloseTo(before[3] / 2);
  expect(reviewStrength(state, seen, model, now + model.recallHalfLife * day)).toBeCloseTo(0.5);
  observe(state, { ...seen, accepted: false, at: now + day }, model);
  expect(reviewStrength(state, seen, model, now + day)).toBeLessThan(0.5);
});
it("trained coefficients affect predictions and malformed models are rejected", () => {
  const ctx = context();
  ctx.model.weights[0] = 3;
  expect(rankPractice([question("q")], ctx, now)[0].probability).toBeGreaterThan(
    rankPractice([question("q")], context(), now)[0].probability,
  );
  expect(validPredictor(prior())).toBe(true);
  expect(validPredictor({ ...prior(), version: 3 })).toBe(false);
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

it("fit comes before novelty in matches", () => {
  const seen = question("seen", "medium"),
    fresh = question("fresh", "hard");
  expect(
    matchRecommendationPool(
      [seen, fresh],
      context([], [{ id: seen.id, owner: "alice" }]),
      ["alice", "bob"],
      now,
    ),
  ).toEqual(["seen"]);
});

const curriculumQuestion = (id: string, tag: string, difficulty = "medium") =>
  question(id, difficulty, ["Array", tag]);
const curriculumEvent = (
  id: string,
  tag: string,
  owner: string,
  accepted = true,
  assisted = false,
) => ({
  ...event(id, accepted, now - day, owner),
  ...curriculumQuestion(id, tag),
  assisted,
});
const curriculumPolicy = (
  exposed: LearningQuestion[] = [],
  requestedTopics: string[] = [],
): MatchTopicPolicy => ({
  catalog: [
    { slug: "arrays", aliases: ["array"] },
    { slug: "union-find", aliases: ["disjoint-set", "disjoint-set-union"] },
    { slug: "topological-sort", aliases: ["topological-sorting"] },
    { slug: "dynamic-programming", aliases: ["dp"] },
  ],
  exposedQuestions: new Map(exposed.map((q) => [q.id, q])),
  requestedTopics,
});
const seats = ["alice", "bob"];

it("requires readiness or explicit opt-in for every gated tag", () => {
  const union = curriculumQuestion("union", "Disjoint Set Union"),
    topo = question("topo", "medium", ["Union-Find", "Topological Sorting", "BFS"]),
    core = curriculumQuestion("core", "Sliding Window");
  const alice = [1, 2].map((i) => curriculumEvent(`alice-${i}`, "Union-Find", "alice"));
  const bob = curriculumEvent("bob-1", "Disjoint Set", "bob");
  const mixed = context([
    ...alice,
    bob,
    bob,
    curriculumEvent("assisted", "Union-Find", "bob", true, true),
  ]);
  const candidates = [union, topo, core];
  expect(matchRecommendationPool(candidates, mixed, seats, now, curriculumPolicy())).toEqual([
    "core",
  ]);
  expect(matchRecommendationPool([union], mixed, seats, now, curriculumPolicy())).toEqual([]);
  expect(
    matchRecommendationPool(
      candidates,
      mixed,
      seats,
      now,
      curriculumPolicy([], ["foundational:union-find"]),
    ),
  ).toEqual(["union", "core"]);
  const ready = context([...mixed.events, curriculumEvent("bob-2", "Union-Find", "bob")]);
  expect(matchRecommendationPool(candidates, ready, seats, now, curriculumPolicy())).toEqual([
    "union",
    "core",
  ]);
});

it("prioritizes core techniques until both seats show independent breadth", () => {
  const sliding = curriculumQuestion("sliding", "Sliding Window"),
    dp = curriculumQuestion("dp", "DP");
  const candidates = [sliding, dp];
  const scores = (events: LearningEvent[], requested?: string[]) =>
    matchRecommendationCandidates(
      candidates,
      context(events),
      seats,
      now,
      curriculumPolicy([], requested),
    ).map((row) => [row.technique?.topic, row.technique?.weight]);
  expect(scores([])).toEqual([
    ["sliding-window", 4],
    ["dynamic-programming", 0.25],
  ]);
  const breadth = seats.flatMap((owner) => [
    curriculumEvent(`${owner}-sliding`, "Sliding Window", owner),
    curriculumEvent(`${owner}-binary`, "Binary Search", owner),
  ]);
  expect(scores(breadth.slice(0, 3))).toEqual(scores([]));
  expect(scores(breadth)).toEqual([
    ["sliding-window", 2],
    ["dynamic-programming", 1],
  ]);
  expect(scores([], ["DP"])).toEqual([
    ["sliding-window", 4],
    ["dynamic-programming", 2],
  ]);
});

it("rotates a technique across questions and draws buckets independently of catalog size", () => {
  const recent = curriculumQuestion("old", "Sliding Window");
  const questions = [
    ...Array.from({ length: 20 }, (_, i) => curriculumQuestion(`sliding-${i}`, "Sliding Window")),
    curriculumQuestion("binary", "Binary Search"),
  ];
  const rank = (ctx: RecommendationContext) =>
    matchRecommendationCandidates(questions, ctx, seats, now, curriculumPolicy([recent]));
  expect(matchTechniquePool(rank(context()), 0.49).map((row) => row.id)).toEqual(["binary"]);
  expect(matchTechniquePool(rank(context()), 0.51)).toHaveLength(20);
  const rotated = rank(context([], [{ id: recent.id, owner: "bob" }]));
  expect(matchTechniquePool(rotated, 0.8).map((row) => row.id)).toEqual(["binary"]);
  expect(rotated[0].technique?.weight).toBeCloseTo(0.6);
});

it("requires repeated unresolved struggles on every seat to boost a refresher", () => {
  const candidate = curriculumQuestion("binary", "Binary Search");
  const failures = seats.flatMap((owner) =>
    [1, 2].map((i) => curriculumEvent(`${owner}-${i}`, "Binary Search", owner, false)),
  );
  const brushUp = (events: LearningEvent[]) =>
    matchRecommendationCandidates([candidate], context(events), seats, now, curriculumPolicy())[0]
      .technique;
  expect(brushUp(failures.slice(0, 3))?.brushUp).toBe(false);
  expect(brushUp(failures)).toMatchObject({ brushUp: true, weight: 5.4 });
  const solved = { ...failures[0], accepted: true, at: now };
  expect(brushUp([...failures, solved])?.brushUp).toBe(false);
  const ctx = context(failures);
  ctx.model.itemBias.easy = -1;
  const rows = matchRecommendationCandidates(
    [candidate, curriculumQuestion("easy", "Binary Search", "easy")],
    ctx,
    seats,
    now,
    curriculumPolicy(),
  );
  expect(rows).toHaveLength(2);
  expect(matchTechniquePool(rows, 0)).toMatchObject([{ id: "easy" }]);
});
