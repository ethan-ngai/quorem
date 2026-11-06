/** @file ranking.ts @description Practice learning utility and all-seat competitive fairness. @module problems */
import {
  cosine,
  decay,
  learner,
  predict,
  profiles,
  recall,
  type Exposure,
  type LearningEvent,
  type LearningQuestion,
  type Predictor,
} from "./model.ts";
export type RecommendationReason = "review" | "weak_topic" | "new_topic" | "challenge" | "practice";
export type RecommendationContext = {
  events: LearningEvent[];
  exposures: Exposure[];
  model: Predictor;
};
const mean = (values: number[]) =>
  values.reduce((sum, x) => sum + x, 0) / Math.max(1, values.length);
/** Similar questions diversify the slate even when their tags differ. */
export function questionSimilarity(a: LearningQuestion, b: LearningQuestion): number {
  const semantic = Math.max(0, cosine(a.embedding, b.embedding));
  const overlap =
    a.tags.filter((tag) => b.tags.includes(tag)).length /
    Math.max(1, new Set([...a.tags, ...b.tags]).size);
  return Math.max(semantic, overlap);
}
export function rankPractice(
  questions: readonly LearningQuestion[],
  context: RecommendationContext,
  now: number,
  limit = questions.length,
) {
  const state = [...profiles(context.events, context.model, now).values()][0] ?? learner();
  const exposures = new Map(context.exposures.map((e) => [e.id, e.lastSeen]));
  const remaining = questions.map((question) => {
    const probability = predict(state, question, context.model, now, "practice");
    const memory = state.memory.get(question.key);
    const retention = recall(state, question, context.model, now);
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
      score:
        2 * (1 - Math.abs(probability - 0.65)) +
        (due ? 1 - retention : 0) +
        (seen === undefined ? 0.2 : 0) +
        (novel ? 0.1 : 0) -
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
            .map((previous) => questionSimilarity(item.question, previous.question)),
        );
    let best = 0,
      bestScore = score(remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
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
export function matchRecommendationPool(
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
        ? person.state.memory.get(question.key)?.successAt != null
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
    return {
      id: question.id,
      seen: familiarity.reduce<number>((a, b) => a + b, 0),
      imbalance: Math.max(...familiarity) - Math.min(...familiarity),
      score:
        1 -
        Math.abs(mean(chances) - 0.55) -
        2 * (Math.max(...chances) - Math.min(...chances)) -
        0.5 * recent,
    };
  });
  const fresh = rows.filter((row) => row.seen === 0),
    imbalance = Math.min(...rows.map((row) => row.imbalance));
  const pool = fresh.length ? fresh : rows.filter((row) => row.imbalance === imbalance);
  const best = Math.max(...pool.map((row) => row.score));
  return pool.filter((row) => row.score >= best - 0.1).map((row) => row.id);
}
