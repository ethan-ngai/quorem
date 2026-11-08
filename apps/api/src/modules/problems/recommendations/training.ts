/** @file training.ts @description Chronological learning, evaluation and promotion gates. @module problems */
import {
  clamp,
  day,
  replay,
  reviewFeatureIndex,
  topicGapFeatureIndex,
  orderedEvents,
  prior,
  type LearningEvent,
  type Predictor,
} from "./model.ts";
import { practiceSolveTarget } from "./ranking.ts";
export type Metrics = {
  count: number;
  logLoss: number;
  brier: number;
  delayedCount: number;
  delayedBrier: number | null;
};
export function evaluate(
  model: Predictor,
  events: readonly LearningEvent[],
  from: number,
  until: number,
): Metrics {
  let count = 0,
    logLoss = 0,
    brier = 0,
    delayedCount = 0,
    delayedBrier = 0;
  replay(
    events.filter((e) => e.at < until),
    model,
    (event, values, probability, _weight, previous) => {
      if (event.at < from) return;
      const p = clamp(probability, 0.000001, 0.999999),
        y = Number(event.accepted);
      count++;
      logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
      brier += (p - y) ** 2;
      if (!event.assisted && event.at - (previous ?? event.at) >= day) {
        delayedCount++;
        delayedBrier += (values[reviewFeatureIndex] - y) ** 2;
      }
    },
  );
  return {
    count,
    logLoss: logLoss / Math.max(1, count),
    brier: brier / Math.max(1, count),
    delayedCount,
    delayedBrier: delayedCount ? delayedBrier / delayedCount : null,
  };
}
function holdoutSlices(model: Predictor, events: readonly LearningEvent[], from: number) {
  const people = new Map<string, number>();
  const questions = new Map<string, number>();
  const pairs = new Map<string, Map<string, number>>();
  const empty = () => ({ count: 0, predicted: 0, solved: 0, brier: 0, logLoss: 0 });
  const slices = {
    practice: empty(),
    match: empty(),
    newLearner: empty(),
    newCatalogQuestion: empty(),
    newToLearner: empty(),
    aroundPracticeTarget: empty(),
  };
  replay(events, model, (event, _values, probability) => {
    const history = pairs.get(event.owner) ?? new Map<string, number>();
    const add = (slice: ReturnType<typeof empty>) => {
      const y = Number(event.accepted);
      slice.count++;
      slice.predicted += probability;
      slice.solved += y;
      slice.brier += (probability - y) ** 2;
      const p = clamp(probability, 0.000001, 0.999999);
      slice.logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    };
    if (event.at >= from) {
      add(slices[event.context]);
      if ((people.get(event.owner) ?? Infinity) >= event.at) add(slices.newLearner);
      if ((questions.get(event.id) ?? Infinity) >= from) add(slices.newCatalogQuestion);
      if ((history.get(event.id) ?? Infinity) >= event.at) add(slices.newToLearner);
      if (event.context === "practice" && Math.abs(probability - practiceSolveTarget) <= 0.05)
        add(slices.aroundPracticeTarget);
    }
    if (!people.has(event.owner)) people.set(event.owner, event.at);
    if (!questions.has(event.id)) questions.set(event.id, event.at);
    if (!history.has(event.id)) history.set(event.id, event.at);
    if (!pairs.has(event.owner)) pairs.set(event.owner, history);
  });
  return Object.fromEntries(
    Object.entries(slices).map(([key, slice]) => {
      const count = Math.max(1, slice.count);
      return [
        key,
        {
          count: slice.count,
          meanPrediction: slice.count ? slice.predicted / count : null,
          solveRate: slice.count ? slice.solved / count : null,
          brier: slice.count ? slice.brier / count : null,
          logLoss: slice.count ? slice.logLoss / count : null,
        },
      ];
    }),
  );
}
function fit(
  events: readonly LearningEvent[],
  halfLife: number,
  recallHalfLife: number,
  now: number,
  learnTopicGap: boolean,
): Predictor {
  const model = prior();
  model.skillHalfLife = halfLife;
  model.recallHalfLife = recallHalfLife;
  // Replaying in time order prevents future outcomes entering learner features.
  for (let epoch = 0; epoch < 8; epoch++) {
    replay(events, model, (event, values, probability, weight) => {
      const rate = (0.03 / Math.sqrt(epoch + 1)) * 2 ** (-Math.max(0, now - event.at) / (90 * day));
      const error = (Number(event.accepted) - probability) * weight;
      model.weights = model.weights.map((weight, i) =>
        clamp(
          weight + rate * (error * values[i] - 0.01 * weight),
          (i >= 2 && i <= reviewFeatureIndex) || i === topicGapFeatureIndex ? 0 : -8,
          i === 1 ? 0 : 8,
        ),
      );
      // Bound the gap weight so improving any topic can only help.
      model.weights[topicGapFeatureIndex] = learnTopicGap
        ? Math.min(model.weights[topicGapFeatureIndex], model.weights[3])
        : 0;
      model.itemBias[event.id] = clamp(
        (model.itemBias[event.id] ?? 0) + rate * (error - 0.1 * (model.itemBias[event.id] ?? 0)),
        -3,
        3,
      );
    });
  }
  model.trainedAt = now;
  return model;
}
export type TrainingResult = {
  model: Predictor;
  metrics: Metrics;
  baseline: Metrics;
  incumbent: Metrics;
  meanTopics: Metrics;
  usesTopicGap: boolean;
  slices: ReturnType<typeof holdoutSlices>;
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
  function tune(learnTopicGap: boolean) {
    let best = prior();
    let bestLoss = Infinity;
    for (const halfLife of [7, 30, 90])
      for (const recallHalfLife of [7, 3, 14, 45]) {
        const candidate = fit(training, halfLife, recallHalfLife, trainUntil, learnTopicGap);
        const metrics = evaluate(candidate, rows, trainUntil, testFrom);
        if (recallHalfLife !== 7 && metrics.delayedCount < 40) continue;
        const loss =
          metrics.logLoss + (metrics.delayedCount >= 40 ? (metrics.delayedBrier ?? 0) : 0);
        if (metrics.count && loss < bestLoss) {
          best = candidate;
          bestLoss = loss;
        }
      }
    return { best, bestLoss };
  }
  const meanOnly = tune(false);
  const withGap = tune(true);
  const usesTopicGap = withGap.bestLoss < meanOnly.bestLoss - 0.005;
  const { best, bestLoss } = usesTopicGap ? withGap : meanOnly;
  const meanModel = fit(
    refit,
    meanOnly.best.skillHalfLife,
    meanOnly.best.recallHalfLife,
    now,
    false,
  );
  const model = usesTopicGap
    ? fit(refit, best.skillHalfLife, best.recallHalfLife, now, true)
    : meanModel;
  const metrics = evaluate(model, rows, testFrom, now + 1),
    baseline = evaluate(prior(), rows, testFrom, now + 1);
  const previous = evaluate(incumbent, rows, testFrom, now + 1);
  const meanTopics = usesTopicGap ? evaluate(meanModel, rows, testFrom, now + 1) : metrics;
  const learners = new Set(rows.map((e) => e.owner)).size;
  const enough =
    rows.length >= 200 &&
    learners >= 10 &&
    metrics.count >= 40 &&
    trainUntil < testFrom &&
    Number.isFinite(bestLoss);
  const validatedReview =
    model.recallHalfLife === prior().recallHalfLife ||
    (metrics.delayedCount >= 40 &&
      metrics.delayedBrier !== null &&
      baseline.delayedBrier !== null &&
      metrics.delayedBrier <= baseline.delayedBrier + 0.005);
  const improved =
    validatedReview &&
    metrics.logLoss < Math.min(baseline.logLoss, previous.logLoss) - 0.005 &&
    metrics.brier <= Math.min(baseline.brier, previous.brier) + 0.005 &&
    (!usesTopicGap ||
      (metrics.logLoss < meanTopics.logLoss && metrics.brier <= meanTopics.brier + 0.005));
  return {
    model,
    metrics,
    baseline,
    incumbent: previous,
    meanTopics,
    usesTopicGap,
    slices: holdoutSlices(model, rows, testFrom),
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
