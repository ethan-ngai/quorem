/** @file schedule.ts @description Preserve the earliest realtime heartbeat alarm. @module runtime */
export async function armSocketAlarm(
  storage: { getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void> },
  now: number,
  next = now + 10_000,
): Promise<void> {
  const current = await storage.getAlarm();
  if (current === null || current > next) await storage.setAlarm(next);
}
