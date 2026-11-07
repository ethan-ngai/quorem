/** @file useSubmissionTimeEnded.ts @description Deadline guard anchored to the server snapshot. @module matches */
import { useEffect, useState } from "react";

/** @returns Whether the current cutoff has passed, including when a refund restores time. */
export function useSubmissionTimeEnded(serverNow?: string, deadline?: string) {
  const delay = serverNow && deadline ? Date.parse(deadline) - Date.parse(serverNow) : undefined;
  const [endedDeadline, setEndedDeadline] = useState<string>();
  const ended = delay !== undefined && (delay <= 0 || endedDeadline === deadline);
  useEffect(() => {
    if (!deadline || delay === undefined || ended) return;
    const timer = window.setTimeout(() => setEndedDeadline(deadline), delay);
    return () => window.clearTimeout(timer);
  }, [deadline, delay, ended]);
  return ended;
}
