import type { InterviewRuleEvent } from "@quorem/contracts";
import { InterviewError } from "./api";
export type InterviewRuleKind = InterviewRuleEvent["kind"];

/** Retry a bounded in-memory queue with the original server idempotency key. */
export function createInterviewRuleReporter(
  send: (kind: InterviewRuleKind, key: string) => Promise<unknown>,
) {
  const pending: { kind: InterviewRuleKind; key: string }[] = [];
  let stopped = true,
    connected = false,
    running = false,
    generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain() {
    if (stopped || !connected || running) return;
    running = true;
    const current = generation;
    try {
      while (!stopped && connected && current === generation && pending.length) {
        const event = pending[0]!;
        try {
          await send(event.kind, event.key);
        } catch (cause) {
          if (stopped || current !== generation) break;
          if (!(cause instanceof InterviewError && cause.status < 500 && cause.status !== 429)) {
            timer = setTimeout(() => {
              timer = undefined;
              void drain();
            }, 1000);
            break;
          }
        }
        if (current === generation && pending[0]?.key === event.key) pending.shift();
      }
    } finally {
      running = false;
      if (!timer && !stopped && connected && pending.length) void drain();
    }
  }
  return {
    start() {
      stopped = false;
      generation++;
    },
    stop() {
      stopped = true;
      generation++;
      pending.length = 0;
      clearTimeout(timer);
      timer = undefined;
    },
    connected(value: boolean) {
      connected = value;
      clearTimeout(timer);
      timer = undefined;
      if (connected) void drain();
    },
    report(this: void, kind: InterviewRuleKind) {
      if (stopped) return;
      if (pending.length >= 100) pending.shift();
      pending.push({ kind, key: crypto.randomUUID() });
      void drain();
    },
  };
}

/** Suppress historical/repeated snapshots and ignore out-of-order refreshes. */
export function createInterviewAlertTracker() {
  let version = -1;
  let seen = new Set<string>();
  return (nextVersion: number, events: readonly InterviewRuleEvent[]) => {
    if (nextVersion < version) return [];
    const added = version < 0 ? [] : events.filter((event) => !seen.has(event.id));
    seen = new Set(events.map((event) => event.id));
    version = nextVersion;
    return added;
  };
}
export function interviewEventDescription(kind: InterviewRuleKind) {
  return kind === "paste" ? "pasted into the code editor" : "left the interview window";
}
