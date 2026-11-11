import { expect, it, vi } from "vitest";
import type { AdmissionAlarmStorage } from "../../modules/judging/admission/recovery.ts";
import { ActivityMaintenance } from "./activity-maintenance.ts";
import { recoverAll } from "./recovery.ts";
it("attempts every capability even when a provider fails", async () => {
  const called: string[] = [];
  await expect(
    recoverAll([
      () => {
        called.push("wake");
        throw new Error("provider secret");
      },
      async () => {
        called.push("deadline");
      },
    ]),
  ).rejects.toThrow("Runtime recovery unavailable");
  expect(called).toEqual(["wake", "deadline"]);
});

it("coalesces activity, retries failed repair and stops after the trailing pass", async () => {
  let due: number | null = null;
  const values = new Map<string, unknown>();
  const storage: AdmissionAlarmStorage = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, value);
    },
    async getAlarm() {
      return due;
    },
    async setAlarm(at) {
      due = at;
    },
    async deleteAlarm() {
      due = null;
    },
    async transaction(fn) {
      return fn(storage);
    },
  };
  const repair = vi.fn<(activity: boolean, retain: boolean) => Promise<boolean>>();
  repair.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(false);
  const actor = new ActivityMaintenance(storage, repair);
  const fire = (time: number) => {
    vi.setSystemTime(time);
    due = null;
    return actor.alarm();
  };
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    expect(await actor.initialized()).toBe(false);
    expect(due).toBeNull();
    await actor.request();
    vi.setSystemTime(59_000);
    await actor.request();
    expect(due).toBe(60_000);
    await expect(fire(60_000)).rejects.toThrow("unavailable");
    await fire(62_000);
    expect(repair.mock.calls).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(due).toBe(122_000);
    repair.mockResolvedValueOnce(true);
    await fire(122_000);
    expect(repair).toHaveBeenLastCalledWith(true, false);
    expect(due).toBe(182_000);
    await fire(182_000);
    expect(repair).toHaveBeenLastCalledWith(false, false);
    expect(due).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
