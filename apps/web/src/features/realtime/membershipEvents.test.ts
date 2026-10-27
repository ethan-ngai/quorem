/** @file membershipEvents.test.ts @description Shared membership socket lifecycle and invalidation delivery. @module realtime */
import { expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  options: undefined as any,
  create: vi.fn(),
  stop: vi.fn(),
  start: vi.fn(),
}));
vi.mock("./reconnectingSocket", () => ({
  createReconnectingSocket: (options: unknown) => {
    transport.create();
    transport.options = options;
    return { start: transport.start, stop: transport.stop, current: undefined };
  },
}));
import {
  membershipSynchronizer,
  retryMembershipEvents,
  subscribeMembershipEvents,
} from "./membershipEvents";

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

it("reloads again when a membership change races an in-flight snapshot", async () => {
  let finish!: (value: { isError: boolean }) => void;
  const refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ isError: false });
  const status = vi.fn();
  const sync = membershipSynchronizer(refresh, status);
  sync.event("changed");
  sync.event("changed");
  expect(refresh).toHaveBeenCalledTimes(1);
  finish({ isError: false });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(status).toHaveBeenCalledWith("ready"));
  sync.stop();
});

it("does not restore ready from a response after disconnect", async () => {
  let finish!: (value: { isError: boolean }) => void;
  const refresh = vi.fn(
    () =>
      new Promise<{ isError: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const status = vi.fn();
  const sync = membershipSynchronizer(refresh, status);
  sync.event("changed");
  sync.event("offline");
  finish({ isError: false });
  await Promise.resolve();
  expect(status).toHaveBeenLastCalledWith("offline");
  expect(status).not.toHaveBeenCalledWith("ready");
  sync.stop();
});

it("retries one shared socket without dropping subscribers or creating a second transport", () => {
  vi.clearAllMocks();
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeMembershipEvents("bob", first);
  const stopSecond = subscribeMembershipEvents("bob", second);
  transport.options.onDisconnect();
  retryMembershipEvents("bob");
  expect(transport.stop).toHaveBeenCalledTimes(1);
  expect(transport.start).toHaveBeenCalledTimes(2);
  expect(transport.create).toHaveBeenCalledTimes(1);
  transport.options.onConnecting();
  transport.options.onMessage({ data: JSON.stringify({ type: "membership.updated" }) });
  expect(first).toHaveBeenLastCalledWith("changed");
  expect(second).toHaveBeenLastCalledWith("changed");
  stopFirst();
  expect(transport.stop).toHaveBeenCalledTimes(1);
  stopSecond();
  expect(transport.stop).toHaveBeenCalledTimes(2);
  retryMembershipEvents("bob");
  expect(transport.start).toHaveBeenCalledTimes(2);
});
