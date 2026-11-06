/** @file matchTime.ts @description Settled round duration and shared clock formatting. @module matches */
export function elapsedRoundSeconds(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined;
  const seconds = Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function formatRoundTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
