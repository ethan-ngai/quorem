/** @file ranking.ts @description Practice learning utility and all-seat competitive fairness. @module problems */
import {
  decay,
  learner,
  predict,
  profiles,
  reviewStrength,
  type Exposure,
  type LearningEvent,
  type LearningQuestion,
  type Predictor,
} from "./model.ts";
export const practiceSolveTarget = 0.65;
export type RecommendationReason = "review" | "weak_topic" | "new_topic" | "challenge" | "practice";
export type RecommendationContext = {
  events: LearningEvent[];
  exposures: Exposure[];
  model: Predictor;
  modelId?: string | null;
};
const mean = (values: number[]) =>
  values.reduce((sum, x) => sum + x, 0) / Math.max(1, values.length);
export function topicSimilarity(a: readonly string[], b: readonly string[]): number {
  return a.filter((tag) => b.includes(tag)).length / Math.max(1, new Set([...a, ...b]).size);
}
export function rankPractice(
  questions: readonly LearningQuestion[],
  context: RecommendationContext,
  now: number,
  limit = questions.length,
  explore = false,
) {
  const state = [...profiles(context.events, context.model, now).values()][0] ?? learner();
  const exposures = new Map(context.exposures.map((e) => [e.id, e.lastSeen]));
  const remaining = questions.map((question) => {
    const probability = predict(state, question, context.model, now, "practice");
    const memory = state.memory.get(question.id);
    const retention = reviewStrength(state, question, context.model, now);
    const due = memory?.successAt != null && retention < 0.8;
    const weak = question.tags.some(
      (tag) =>
        (state.topics.get(tag) ?? 0) * decay(now - state.at, context.model.skillHalfLife) < -0.2,
    );
    const novel = question.tags.some((tag) => !state.topics.has(tag));
    const seen = exposures.get(question.id);
    const recent = seen === undefined ? 0 : decay(now - seen, 1);
    const reason: RecommendationReason = due
      ? "review"
      : weak
        ? "weak_topic"
        : novel
          ? "new_topic"
          : "challenge";
    return {
      question,
      reason,
      probability,
      recentlyOpened: seen !== undefined && now - seen < 30 * 60_000,
      explore: seen === undefined && novel && Math.abs(probability - practiceSolveTarget) <= 0.25,
      score:
        2 * (1 - Math.abs(probability - practiceSolveTarget)) +
        (due ? 1 - retention : 0) +
        (seen === undefined ? 0.2 : 0) +
        (novel ? 0.1 : 0) +
        (weak ? 0.1 : 0) -
        2 * recent,
    };
  });
  const selected: typeof remaining = [];
  while (remaining.length && selected.length < limit) {
    const score = (item: (typeof remaining)[number]) =>
      item.score -
      0.35 *
        Math.max(
          0,
          ...selected
            .slice(-2)
            .map((previous) => topicSimilarity(item.question.tags, previous.question.tags)),
        );
    const fresh = remaining.some((item) => !item.recentlyOpened);
    const exploreSlot =
      explore &&
      selected.length === 2 &&
      remaining.some((item) => item.explore && !item.recentlyOpened);
    let best = -1,
      bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      if ((fresh && remaining[i].recentlyOpened) || (exploreSlot && !remaining[i].explore))
        continue;
      const candidateScore = score(remaining[i]);
      if (
        candidateScore > bestScore ||
        (candidateScore === bestScore && remaining[i].question.id < remaining[best].question.id)
      ) {
        best = i;
        bestScore = candidateScore;
      }
    }
    selected.push(remaining.splice(best, 1)[0]);
  }
  return selected;
}
export function matchRecommendationCandidates(
  questions: readonly LearningQuestion[],
  context: RecommendationContext,
  owners: readonly string[],
  now: number,
) {
  if (!questions.length || !owners.length) return [];
  const learned = profiles(context.events, context.model, now);
  const people = [...new Set(owners)].map((owner) => ({
    state: learned.get(owner) ?? learner(),
    seen: new Map(
      context.exposures.filter((e) => e.owner === owner).map((e) => [e.id, e.lastSeen]),
    ),
  }));
  const rows = questions.map((question) => {
    const familiarity = people.map((person) =>
      person.seen.has(question.id)
        ? person.state.memory.get(question.id)?.successAt != null
          ? 2
          : 1
        : 0,
    );
    const chances = people.map((person) =>
      predict(person.state, question, context.model, now, "match"),
    );
    const recent = mean(
      people.map((person) =>
        person.seen.has(question.id) ? decay(now - person.seen.get(question.id)!, 7) : 0,
      ),
    );
    const average = mean(chances);
    const spread = Math.max(...chances) - Math.min(...chances);
    return {
      id: question.id,
      average,
      spread,
      seen: familiarity.reduce<number>((a, b) => a + b, 0),
      imbalance: Math.max(...familiarity) - Math.min(...familiarity),
      score: 1 - Math.abs(average - 0.55) - 2 * spread - 0.5 * recent,
    };
  });
  const suitable = rows.filter(
    (row) => row.average >= 0.35 && row.average <= 0.75 && row.spread <= 0.25,
  );
  if (!suitable.length) {
    const best = Math.max(...rows.map((row) => row.score));
    return rows.filter((row) => row.score >= best - 0.1);
  }
  const fresh = suitable.filter((row) => row.seen === 0);
  const imbalance = Math.min(...suitable.map((row) => row.imbalance));
  const pool = fresh.length ? fresh : suitable.filter((row) => row.imbalance === imbalance);
  const best = Math.max(...pool.map((row) => row.score));
  return pool.filter((row) => row.score >= best - 0.1);
}
