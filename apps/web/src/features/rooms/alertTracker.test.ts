import { expect, it } from "vitest";
import { createAlertTracker } from "./alertTracker";

it("silences history and repeated or stale snapshots, including large match versions", () => {
  const track = createAlertTracker();
  const old = { id: "old" },
    fresh = { id: "new" };
  const version = 9007199254740993n;
  expect(track(version, [old])).toEqual([]);
  expect(track(version + 1n, [old, fresh])).toEqual([fresh]);
  expect(track(version, [old])).toEqual([]);
  expect(track(version + 1n, [old, fresh])).toEqual([]);
  expect(track(version + 2n, [fresh])).toEqual([]);
});
