/** @file match-curriculum.ts @description Shared readiness and technique weights for automatic match draws. @module problems */
import { day, decay, orderedEvents, type LearningQuestion } from "./model.ts";
import type { RecommendationContext } from "./ranking.ts";

const core = new Set([
  "binary-search",
  "breadth-first-search",
  "depth-first-search",
  "hash-tables",
  "intervals",
  "prefix-sums",
  "sliding-window",
  "sorting",
  "stack",
  "two-pointers",
]);
const advanced = new Set(["minimum-spanning-trees", "topological-sort", "union-find"]);
const broad = new Set(["arrays", "binary-trees", "graphs", "strings"]);
const dp = "dynamic-programming";
const independentSolves = 2;
const struggleWindow = 30 * day;
export const matchTopicExposureWindow = 14 * day;

export type MatchTopic = { slug: string; aliases: string[] };
export type MatchTopicPolicy = {
  catalog: readonly MatchTopic[];
  exposedQuestions: ReadonlyMap<string, LearningQuestion>;
  requestedTopics: readonly string[];
};

function topicResolver(catalog: readonly MatchTopic[]) {
  const aliases = new Map(
    catalog.flatMap(({ slug, aliases }) =>
      [slug, ...aliases].map((alias) => [alias, slug] as const),
    ),
  );
  const techniquePriority = (topic: string) => {
    if (advanced.has(topic)) return 4;
    if (topic === dp) return 3;
    if (core.has(topic) || (aliases.has(topic) && !broad.has(topic))) return 2;
    return broad.has(topic) ? 0 : 1;
  };
  const canonical = (tag: string) => {
    const key = tag
      .replace(/^foundational:/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return aliases.get(key) ?? key;
  };
  return {
    canonical,
    tags: (question: LearningQuestion) =>
      question.tags.map(canonical).filter((tag) => tag && tag !== "sql"),
    technique: (topics: readonly string[]) =>
      topics.reduce(
        (best, topic) =>
          techniquePriority(topic) > techniquePriority(best) || !best ? topic : best,
        "",
      ) || "untagged",
  };
}

/** Resolve per-seat skill evidence once, then reuse it for every candidate. */
export function matchCurriculum(
  context: RecommendationContext,
  owners: readonly string[],
  now: number,
  policy: MatchTopicPolicy,
) {
  const { canonical, tags, technique } = topicResolver(policy.catalog);
  const requested = new Set(policy.requestedTopics.map(canonical));
  const people = new Map(
    owners.map((owner) => [
      owner,
      {
        solvedQuestions: new Set<string>(),
        solves: new Map<string, Set<string>>(),
        struggles: new Map<string, Set<string>>(),
      },
    ]),
  );
  const topicLastSeen = new Map<string, number>();

  // A solve contributes to one technique, even when the question has several tags.
  for (const event of orderedEvents(context.events, now)) {
    const person = people.get(event.owner);
    if (!person || event.assisted) continue;
    const solved = person.solvedQuestions.has(event.id);
    const topic = technique(tags(event));
    const solves = person.solves.get(topic) ?? new Set<string>();
    const struggles = person.struggles.get(topic) ?? new Set<string>();
    if (event.accepted) {
      if (!solved) solves.add(event.id);
      person.solvedQuestions.add(event.id);
      for (const priorStruggles of person.struggles.values()) priorStruggles.delete(event.id);
    } else if (!solved && now - event.at <= struggleWindow) {
      struggles.add(event.id);
    }
    person.solves.set(topic, solves);
    person.struggles.set(topic, struggles);
  }
  for (const exposure of context.exposures) {
    if (!people.has(exposure.owner) || now - exposure.lastSeen > matchTopicExposureWindow) continue;
    const question = policy.exposedQuestions.get(exposure.id);
    if (!question) continue;
    const topic = technique(tags(question));
    topicLastSeen.set(topic, Math.max(topicLastSeen.get(topic) ?? -Infinity, exposure.lastSeen));
  }

  const seats = [...people.values()];
  const readyForCore = seats.every(
    ({ solves }) =>
      [...solves].filter(([topic, ids]) => core.has(topic) && ids.size > 0).length >= 2,
  );
  const ready = new Set(
    [...advanced, dp].filter((topic) =>
      seats.every(({ solves }) => (solves.get(topic)?.size ?? 0) >= independentSolves),
    ),
  );
  return (question: LearningQuestion) => {
    const topics = tags(question);
    if (topics.some((topic) => advanced.has(topic) && !requested.has(topic) && !ready.has(topic))) {
      return null;
    }
    const topic = technique(topics);
    const lastSeen = topicLastSeen.get(topic);
    const rotation = lastSeen === undefined ? 1 : 1 - 0.85 * decay(now - lastSeen, 2);
    const brushUp =
      topic !== "untagged" &&
      seats.every(({ struggles }) => (struggles.get(topic)?.size ?? 0) >= 2);
    let priority = 1;
    if (core.has(topic)) priority = readyForCore ? 2 : 4;
    if (topic === dp) priority = requested.has(dp) || ready.has(dp) ? 2 : readyForCore ? 1 : 0.25;
    return { topic, weight: priority * rotation * (brushUp ? 1.35 : 1), brushUp };
  };
}
