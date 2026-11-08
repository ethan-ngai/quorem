/** @file model.ts @description Learned success predictor with decaying learner state. @module problems */
export const day = 86400000;
export type LearningQuestion = {
  id: string;
  difficulty: string;
  tags: string[];
};
export type LearningEvent = LearningQuestion & {
  eventId: string;
  owner: string;
  at: number;
  accepted: boolean;
  attempts?: number;
  assisted?: boolean;
  context: "practice" | "match";
};
export type Exposure = { owner: string; id: string; lastSeen: number };
export type Predictor = {
  version: 5;
  trainedAt: number;
  weights: number[];
  itemBias: Record<string, number>;
  skillHalfLife: number;
  recallHalfLife: number;
};
/** Explicit untrained prior; training must earn promotion on held-out outcomes. */
export function prior(): Predictor {
  return {
    version: 5,
    trainedAt: 0,
    weights: [0, -1, 1, 1, 1, 0, 0],
    itemBias: {},
    skillHalfLife: 30,
    recallHalfLife: 7,
  };
}
export function validPredictor(value: unknown): value is Predictor {
  if (!value || typeof value !== "object") return false;
  const p = value as Predictor;
  return (
    p.version === 5 &&
    Number.isFinite(p.trainedAt) &&
    Array.isArray(p.weights) &&
    p.weights.length === 7 &&
    p.weights.every((x) => Number.isFinite(x) && Math.abs(x) <= 8) &&
    p.weights[1] <= 0 &&
    p.weights.slice(2, 5).every((x) => x >= 0) &&
    p.weights[topicGapFeatureIndex] >= 0 &&
    p.weights[topicGapFeatureIndex] <= p.weights[3] &&
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
type Memory = { successAt: number | null; successes: number; lastAt: number };
export type Learner = {
  at: number;
  ability: number;
  topics: Map<string, number>;
  memory: Map<string, Memory>;
};
export function learner(): Learner {
  return { at: 0, ability: 0, topics: new Map(), memory: new Map() };
}
function advance(state: Learner, model: Predictor, at: number) {
  const factor = decay(at - state.at, model.skillHalfLife);
  state.ability *= factor;
  for (const [tag, value] of state.topics) state.topics.set(tag, value * factor);
  state.at = Math.max(state.at, at);
}
export function reviewStrength(
  state: Learner,
  q: LearningQuestion,
  model: Predictor,
  at: number,
): number {
  const memory = state.memory.get(q.id);
  if (memory?.successAt == null) return 0;
  const halfLife = Math.min(90, model.recallHalfLife * Math.sqrt(Math.max(1, memory.successes)));
  return decay(at - memory.successAt, halfLife) * (memory.successes === 0 ? 0.5 : 1);
}
export const reviewFeatureIndex = 4;
export const topicGapFeatureIndex = 6;

export function features(
  state: Learner,
  q: LearningQuestion,
  model: Predictor,
  at: number,
  context: "practice" | "match",
): number[] {
  const fade = decay(at - state.at, model.skillHalfLife);
  let totalSkill = 0;
  let weakestSkill = Infinity;
  for (const tag of q.tags) {
    const skill = state.topics.get(tag) ?? 0;
    totalSkill += skill;
    weakestSkill = Math.min(weakestSkill, skill);
  }
  const meanSkill = totalSkill / Math.max(1, q.tags.length);
  return [
    1,
    q.difficulty === "easy" ? -1 : q.difficulty === "hard" ? 1 : 0,
    state.ability * fade,
    meanSkill * fade,
    reviewStrength(state, q, model, at),
    context === "match" ? 1 : 0,
    q.tags.length ? (weakestSkill - meanSkill) * fade : 0,
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
  return predictFeatures(model, features(state, q, model, at, context), q.id);
}
/** One bounded update per closed session. Retry effort reduces credit gently. */
export function sessionWeight(event: LearningEvent, lastAt: number | undefined): number {
  if (event.assisted) return 0.25;
  const effort = event.accepted ? 1 / Math.sqrt(1 + 0.15 * ((event.attempts ?? 1) - 1)) : 1;
  return effort * (lastAt !== undefined && event.at - lastAt < day ? 0.25 : 1);
}

export function observe(
  state: Learner,
  event: LearningEvent,
  model: Predictor,
  probability = predict(state, event, model, event.at, event.context),
  weight = sessionWeight(event, state.memory.get(event.id)?.lastAt),
) {
  const previous = state.memory.get(event.id);
  advance(state, model, event.at);
  const error = (Number(event.accepted) - probability) * weight;
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
  if (event.assisted) {
    state.memory.set(event.id, {
      successAt: previous?.successAt ?? null,
      successes: previous?.successes ?? 0,
      lastAt: event.at,
    });
    return;
  }
  const spaced = previous?.successAt == null || event.at - previous.successAt >= day;
  state.memory.set(event.id, {
    lastAt: event.at,
    successAt: event.accepted ? event.at : (previous?.successAt ?? null),
    successes: event.accepted
      ? (previous?.successes ?? 0) + Number(spaced)
      : Math.max(0, (previous?.successes ?? 1) - 1),
  });
}

/** Score simultaneous session closures against the same prior state. */
export function replay(
  events: readonly LearningEvent[],
  model: Predictor,
  visit?: (
    event: LearningEvent,
    values: number[],
    probability: number,
    weight: number,
    previousSuccess: number | null,
  ) => void,
) {
  const people = new Map<string, Learner>();
  for (let start = 0; start < events.length;) {
    let end = start + 1;
    while (end < events.length && events[end].at === events[start].at) end++;
    const batch = events.slice(start, end).map((event) => {
      const state = people.get(event.owner) ?? learner();
      people.set(event.owner, state);
      const values = features(state, event, model, event.at, event.context);
      const previous = state.memory.get(event.id);
      return {
        event,
        state,
        values,
        probability: predictFeatures(model, values, event.id),
        weight: sessionWeight(event, previous?.lastAt),
        previousSuccess: previous?.successAt ?? null,
      };
    });
    for (const { event, state, values, probability, weight, previousSuccess } of batch) {
      visit?.(event, values, probability, weight, previousSuccess);
      observe(state, event, model, probability, weight);
    }
    start = end;
  }
  return people;
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
  return replay(orderedEvents(events, now), model);
}
