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

it("emits a focus return once under the departure's event ID", () => {
  const track = createAlertTracker<{ id: string; awaySeconds?: number }>();
  const departure = { id: "focus" };
  const returned = { ...departure, awaySeconds: 0 };
  expect(track(1n, [])).toEqual([]);
  expect(track(2n, [departure])).toEqual([departure]);
  expect(track(3n, [returned])).toEqual([returned]);
  expect(track(4n, [returned])).toEqual([]);
  expect(track(2n, [departure])).toEqual([]);
});
