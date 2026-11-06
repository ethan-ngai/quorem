/** @file training.ts @description Chronological learning, evaluation and promotion gates. @module problems */
import {
  clamp,
  day,
  learner,
  observe,
  orderedEvents,
  prior,
  type Learner,
  type LearningEvent,
  type Predictor,
} from "./model.ts";
export type Metrics = { count: number; logLoss: number; brier: number };
export function evaluate(
  model: Predictor,
  events: readonly LearningEvent[],
  from: number,
  until: number,
): Metrics {
  const states = new Map<string, Learner>();
  let count = 0,
    logLoss = 0,
    brier = 0;
  for (const event of events) {
    if (event.at >= until) break;
    const state = states.get(event.owner) ?? learner();
    states.set(event.owner, state);
    const result = observe(state, event, model);
    if (!result.first || event.at < from) continue;
    const p = clamp(result.probability, 0.000001, 0.999999),
      y = Number(event.accepted);
    count++;
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    brier += (p - y) ** 2;
  }
  return { count, logLoss: logLoss / Math.max(1, count), brier: brier / Math.max(1, count) };
}
function fit(
  events: readonly LearningEvent[],
  halfLife: number,
  recallHalfLife: number,
  now: number,
): Predictor {
  const model = prior();
  model.skillHalfLife = halfLife;
  model.recallHalfLife = recallHalfLife;
  // Replaying in time order prevents future outcomes entering learner features.
  for (let epoch = 0; epoch < 8; epoch++) {
    const states = new Map<string, Learner>();
    for (const event of events) {
      const state = states.get(event.owner) ?? learner();
      states.set(event.owner, state);
      const result = observe(state, event, model);
      if (!result.first) continue;
      const rate = (0.03 / Math.sqrt(epoch + 1)) * 2 ** (-Math.max(0, now - event.at) / (90 * day));
      const error = Number(event.accepted) - result.probability;
      model.weights = model.weights.map((weight, i) =>
        clamp(
          weight + rate * (error * result.values[i] - 0.01 * weight),
          i >= 2 && i <= 5 ? 0 : -8,
          i === 1 ? 0 : 8,
        ),
      );
      model.itemBias[event.key] = clamp(
        (model.itemBias[event.key] ?? 0) + rate * (error - 0.1 * (model.itemBias[event.key] ?? 0)),
        -3,
        3,
      );
    }
  }
  model.trainedAt = now;
  return model;
}
export type TrainingResult = {
  model: Predictor;
  metrics: Metrics;
  baseline: Metrics;
  incumbent: Metrics;
  eligible: boolean;
  reason: string;
  events: number;
  learners: number;
  trainUntil: number;
  testFrom: number;
};
/** Tune on the middle time block; the final block is untouched until evaluation. */
export function train(
  events: readonly LearningEvent[],
  incumbent: Predictor,
  now: number,
): TrainingResult {
  const rows = orderedEvents(events, now).filter((e) => e.at >= now - 180 * day);
  const trainUntil = rows[Math.floor(rows.length * 0.6)]?.at ?? now;
  // Fresh holdout excludes every observation available to the incumbent.
  const testFrom = Math.max(
    rows[Math.floor(rows.length * 0.8)]?.at ?? now,
    incumbent.trainedAt + 1,
  );
  const training = rows.filter((e) => e.at < trainUntil),
    refit = rows.filter((e) => e.at < testFrom);
  let best = prior(),
    bestLoss = Infinity;
  for (const halfLife of [7, 30, 90])
    for (const recallHalfLife of [3, 14, 45]) {
      const candidate = fit(training, halfLife, recallHalfLife, trainUntil);
      const metrics = evaluate(candidate, rows, trainUntil, testFrom);
      if (metrics.count && metrics.logLoss < bestLoss) {
        best = candidate;
        bestLoss = metrics.logLoss;
      }
    }
  const model = fit(refit, best.skillHalfLife, best.recallHalfLife, now);
  const metrics = evaluate(model, rows, testFrom, now + 1),
    baseline = evaluate(prior(), rows, testFrom, now + 1);
  const previous = evaluate(incumbent, rows, testFrom, now + 1);
  const learners = new Set(rows.map((e) => e.owner)).size;
  const enough =
    rows.length >= 200 &&
    learners >= 10 &&
    metrics.count >= 40 &&
    trainUntil < testFrom &&
    Number.isFinite(bestLoss);
  const improved =
    metrics.logLoss < Math.min(baseline.logLoss, previous.logLoss) - 0.005 &&
    metrics.brier <= Math.min(baseline.brier, previous.brier) + 0.005;
  return {
    model,
    metrics,
    baseline,
    incumbent: previous,
    events: rows.length,
    learners,
    trainUntil,
    testFrom,
    eligible: enough && improved,
    reason: !enough
      ? "insufficient_evidence"
      : !improved
        ? "no_validated_improvement"
        : "validated_improvement",
  };
}
