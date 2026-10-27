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

it("recovers from a failed snapshot when the connected user retries", async () => {
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({ isError: true })
    .mockResolvedValueOnce({ isError: false });
  const status = vi.fn();
  const sync = membershipSynchronizer(refresh, status);
  sync.event("changed");
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("offline"));
  sync.event("changed");
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("ready"));
  expect(refresh).toHaveBeenCalledTimes(2);
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

it("retries failed snapshots with backoff and cancels recovery on disconnect", async () => {
  vi.useFakeTimers();
  try {
    const refresh = vi.fn().mockResolvedValue({ isError: true });
    const status = vi.fn();
    const sync = membershipSynchronizer(refresh, status);
    sync.event("changed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(refresh).toHaveBeenCalledTimes(2);
    refresh.mockResolvedValue({ isError: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenLastCalledWith("ready");
    refresh.mockResolvedValue({ isError: true });
    sync.event("changed");
    await vi.advanceTimersByTimeAsync(0);
    sync.event("offline");
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(status).toHaveBeenLastCalledWith("offline");
    sync.stop();
  } finally {
    vi.useRealTimers();
  }
});
