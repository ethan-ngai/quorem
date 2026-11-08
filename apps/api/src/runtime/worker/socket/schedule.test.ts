/** @file schedule.test.ts @description Socket alarm scheduling. @module runtime */
import { expect, test } from "vitest";
import { armSocketAlarm } from "./schedule.ts";
test("new admissions preserve an earlier heartbeat deadline", async () => {
  let alarm: number | null = null;
  const storage = {
    async getAlarm() {
      return alarm;
    },
    async setAlarm(value: number) {
      alarm = value;
    },
  };
  await armSocketAlarm(storage, 1000);
  await armSocketAlarm(storage, 9000);
  expect(alarm).toBe(11000);
  alarm = 30000;
  await armSocketAlarm(storage, 10000);
  expect(alarm).toBe(20000);
});
