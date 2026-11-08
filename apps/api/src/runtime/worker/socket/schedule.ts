/** @file schedule.ts @description Preserve the earliest realtime heartbeat alarm. @module runtime */
export async function armSocketAlarm(
  storage: { getAlarm(): Promise<number | null>; setAlarm(time: number): Promise<void> },
  now: number,
): Promise<void> {
  const current = await storage.getAlarm(),
    next = now + 10_000;
  if (current === null || current > next) await storage.setAlarm(next);
}
