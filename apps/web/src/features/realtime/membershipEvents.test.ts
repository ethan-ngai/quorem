/** @file membershipEvents.test.ts @description Shared membership socket lifecycle and invalidation delivery. @module realtime */
import { expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ options: undefined as any, stop: vi.fn(), start: vi.fn() }));
vi.mock("./reconnectingSocket", () => ({
  createReconnectingSocket: (options: unknown) => {
    transport.options = options;
    return { start: transport.start, stop: transport.stop, current: undefined };
  },
}));
import { subscribeMembershipEvents } from "./membershipEvents";

it("shares one socket per identity and notifies late subscribers to reload", () => {
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeMembershipEvents("alice", first);
  expect(transport.start).toHaveBeenCalledTimes(1);
  transport.options.onConnecting();
  transport.options.onMessage({ data: JSON.stringify({ type: "membership.updated" }) });
  expect(first).toHaveBeenLastCalledWith("changed");
  const stopSecond = subscribeMembershipEvents("alice", second);
  expect(transport.start).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledWith("changed");
  transport.options.onMessage({ data: JSON.stringify({ type: "heartbeat" }) });
  expect(first).toHaveBeenCalledTimes(2);
  transport.options.onDisconnect();
  expect(first).toHaveBeenLastCalledWith("offline");
  expect(second).toHaveBeenLastCalledWith("offline");
  stopFirst();
  expect(transport.stop).not.toHaveBeenCalled();
  stopSecond();
  expect(transport.stop).toHaveBeenCalledOnce();
});
