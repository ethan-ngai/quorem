/** @file model.ts @description Learned success predictor with decaying learner state. @module problems */
export const day = 86400000;
export const embeddingSpec = {
  revision: "aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f",
  precision: "fp32",
  pooling: "mean",
  dimensions: 384,
} as const;
export const encoder = `minilm-l6-v2:${embeddingSpec.revision}:${embeddingSpec.precision}:${embeddingSpec.pooling}:${embeddingSpec.dimensions}:v1`;
export type LearningQuestion = {
  id: string;
  key: string;
  difficulty: string;
  tags: string[];
  embedding?: number[];
};
export type LearningEvent = LearningQuestion & {
  eventId: string;
  owner: string;
  at: number;
  accepted: boolean;
  context: "practice" | "match";
};
export type Exposure = { owner: string; id: string; lastSeen: number };
export type Predictor = {
  version: 1;
  encoder: string;
  trainedAt: number;
  weights: number[];
  itemBias: Record<string, number>;
  skillHalfLife: number;
  recallHalfLife: number;
};
/** Explicit untrained prior; training must earn promotion on held-out outcomes. */
export function prior(): Predictor {
  return {
    version: 1,
    encoder,
    trainedAt: 0,
    weights: [0, -1, 1, 1, 0.5, 1, 0],
    itemBias: {},
    skillHalfLife: 30,
    recallHalfLife: 7,
  };
}
export function validPredictor(value: unknown): value is Predictor {
  if (!value || typeof value !== "object") return false;
  const p = value as Predictor;
  return (
    p.version === 1 &&
    p.encoder === encoder &&
    Number.isFinite(p.trainedAt) &&
    Array.isArray(p.weights) &&
    p.weights.length === 7 &&
    p.weights.every((x) => Number.isFinite(x) && Math.abs(x) <= 8) &&
    p.weights[1] <= 0 &&
    p.weights.slice(2, 6).every((x) => x >= 0) &&
    Number.isFinite(p.skillHalfLife) &&
    Number.isFinite(p.recallHalfLife) &&
    p.skillHalfLife >= 3 &&
    p.skillHalfLife <= 180 &&
    p.recallHalfLife >= 1 &&
    p.recallHalfLife <= 90 &&
    !!p.itemBias &&
    typeof p.itemBias === "object" &&
    !Array.isArray(p.itemBias) &&
    Object.values(p.itemBias).every((x) => Number.isFinite(x) && Math.abs(x) <= 3)
  );
}
export const decay = (elapsed: number, halfLife: number) =>
  2 ** (-Math.max(0, elapsed) / (day * halfLife));
export const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-clamp(x, -20, 20)));
export function projection(a?: readonly number[], b?: readonly number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  return a.reduce((sum, x, i) => sum + x * b[i], 0);
}
export function cosine(a?: readonly number[], b?: readonly number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
  return norm ? clamp(a.reduce((s, x, i) => s + x * b[i], 0) / norm, -1, 1) : 0;
}
type Memory = { successAt: number | null; successes: number; lastDay: number };
export type Learner = {
  at: number;
  ability: number;
  topics: Map<string, number>;
  semantic: number[];
  memory: Map<string, Memory>;
};
export function learner(): Learner {
  return { at: 0, ability: 0, topics: new Map(), semantic: [], memory: new Map() };
}
function advance(state: Learner, model: Predictor, at: number) {
  const factor = decay(at - state.at, model.skillHalfLife);
  state.ability *= factor;
  for (const [tag, value] of state.topics) state.topics.set(tag, value * factor);
  state.semantic = state.semantic.map((x) => x * factor);
  state.at = Math.max(state.at, at);
}
export function recall(state: Learner, q: LearningQuestion, model: Predictor, at: number): number {
  const memory = state.memory.get(q.key);
  if (memory?.successAt == null) return 0;
  const halfLife = Math.min(90, model.recallHalfLife * Math.sqrt(memory.successes));
  return decay(at - memory.successAt, halfLife);
}
export function features(
  state: Learner,
  q: LearningQuestion,
  model: Predictor,
  at: number,
  context: "practice" | "match",
): number[] {
  const fade = decay(at - state.at, model.skillHalfLife);
  const topic =
    q.tags.reduce((sum, tag) => sum + (state.topics.get(tag) ?? 0), 0) / Math.max(1, q.tags.length);
  return [
    1,
    q.difficulty === "easy" ? -1 : q.difficulty === "hard" ? 1 : 0,
    state.ability * fade,
    topic * fade,
    clamp(projection(state.semantic, q.embedding) * fade, -3, 3),
    recall(state, q, model, at),
    context === "match" ? 1 : 0,
  ];
}
export function predictFeatures(model: Predictor, values: readonly number[], key: string): number {
  return sigmoid(
    values.reduce((sum, x, i) => sum + x * model.weights[i], model.itemBias[key] ?? 0),
  );
}
export function predict(
  state: Learner,
  q: LearningQuestion,
  model: Predictor,
  at: number,
  context: "practice" | "match",
): number {
  return predictFeatures(model, features(state, q, model, at, context), q.key);
}
/** Predict before observing. Same-day retries refresh recall but never inflate proficiency. */
export function observe(
  state: Learner,
  event: LearningEvent,
  model: Predictor,
): { first: boolean; probability: number; values: number[] } {
  const values = features(state, event, model, event.at, event.context);
  const probability = predictFeatures(model, values, event.key);
  const previous = state.memory.get(event.key);
  const today = Math.floor(event.at / day);
  const first = previous?.lastDay !== today;
  advance(state, model, event.at);
  if (first) {
    const error = Number(event.accepted) - probability;
    state.ability = clamp(state.ability + 0.3 * error, -3, 3);
    for (const tag of event.tags)
      state.topics.set(
        tag,
        clamp(
          (state.topics.get(tag) ?? 0) + (0.5 * error) / Math.sqrt(Math.max(1, event.tags.length)),
          -3,
          3,
        ),
      );
    if (event.embedding) {
      if (!state.semantic.length) state.semantic = event.embedding.map(() => 0);
      state.semantic = state.semantic.map((value, i) =>
        clamp(value + 0.3 * error * event.embedding![i], -3, 3),
      );
    }
  }
  state.memory.set(event.key, {
    lastDay: today,
    successAt: event.accepted ? event.at : first ? null : (previous?.successAt ?? null),
    successes:
      (first && !event.accepted ? 0 : (previous?.successes ?? 0)) +
      (event.accepted &&
      (previous?.successAt == null || Math.floor(previous.successAt / day) !== today)
        ? 1
        : 0),
  });
  return { first, probability, values };
}
export function orderedEvents(events: readonly LearningEvent[], now: number): LearningEvent[] {
  return events
    .filter((e) => Number.isFinite(e.at) && e.at <= now)
    .toSorted((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId));
}
export function profiles(
  events: readonly LearningEvent[],
  model: Predictor,
  now: number,
): Map<string, Learner> {
  const people = new Map<string, Learner>();
  for (const event of orderedEvents(events, now)) {
    const state = people.get(event.owner) ?? learner();
    observe(state, event, model);
    people.set(event.owner, state);
  }
  return people;
}
