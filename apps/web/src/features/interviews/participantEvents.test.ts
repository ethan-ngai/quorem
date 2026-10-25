import { describe, expect, it } from "vitest";
import { createParticipantTracker } from "./participantEvents";
const peer = (userId: string, clientID = userId) => ({
  userId,
  clientID,
  name: userId,
  epoch: "e",
  version: 0,
  anchor: 0,
  head: 0,
});
describe("participant notifications", () => {
  it("silences initial roster, own tabs, duplicate windows and reconnects", () => {
    const tracker = createParticipantTracker("alice");
    expect(tracker.update([peer("bob")])).toEqual([]);
    expect(tracker.update([peer("alice")])).toEqual([]);
    expect(
      tracker.update([peer("alice"), peer("alice", "other"), peer("bob"), peer("bob", "second")]),
    ).toEqual([{ userId: "bob", name: "bob", joined: true }]);
    expect(tracker.update([peer("alice"), peer("bob", "second")])).toEqual([]);
    expect(tracker.update([peer("alice")])).toEqual([
      { userId: "bob", name: "bob", joined: false },
    ]);
    tracker.reset();
    expect(tracker.update([peer("alice"), peer("bob")])).toEqual([]);
  });
});
