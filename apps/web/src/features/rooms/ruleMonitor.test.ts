import { describe, expect, it, vi } from "vitest";
import { createRuleMonitor, observeWindowFocus } from "./ruleMonitor";

describe("match browser rules", () => {
  it("deduplicates blur/hidden and rearms only on return", () => {
    const report = vi.fn();
    const monitor = createRuleMonitor({ clipboard: "off", focus: "announce" }, report);
    monitor.focus(false);
    monitor.focus(false);
    expect(report).toHaveBeenCalledTimes(1);
    monitor.focus(true);
    monitor.focus(false);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith("focus", "announce");
  });
  it("blocks clipboard attempts without reading data and bounds reports", () => {
    const report = vi.fn();
    let now = 0;
    const monitor = createRuleMonitor({ clipboard: "warning", focus: "off" }, report, () => now);
    expect(monitor.clipboard()).toBe(true);
    monitor.clipboard();
    monitor.focus(false);
    expect(report).toHaveBeenCalledTimes(1);
    now = 1000;
    monitor.clipboard();
    expect(report).toHaveBeenCalledTimes(2);
  });
  it("leaves unrestricted clipboard/focus alone", () => {
    const report = vi.fn();
    const monitor = createRuleMonitor({ clipboard: "off", focus: "off" }, report);
    expect(monitor.clipboard()).toBe(false);
    monitor.focus(false);
    expect(report).not.toHaveBeenCalled();
  });
});

it("shares focus listeners, deduplicates real browser signal types, and removes them on cleanup", () => {
  const browserWindow = new EventTarget();
  const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hasFocus: () => present,
  });
  let present = true;
  const report = vi.fn();
  const monitor = createRuleMonitor({ clipboard: "off", focus: "announce" }, report);
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  try {
    const stop = observeWindowFocus(monitor.focus);
    present = false;
    browserWindow.dispatchEvent(new Event("blur"));
    browserDocument.visibilityState = "hidden";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    expect(report).toHaveBeenCalledTimes(1);
    present = true;
    browserDocument.visibilityState = "visible";
    browserWindow.dispatchEvent(new Event("focus"));
    present = false;
    browserWindow.dispatchEvent(new Event("blur"));
    expect(report).toHaveBeenCalledTimes(2);
    stop();
    browserWindow.dispatchEvent(new Event("blur"));
    expect(report).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("allows notified/penalized clipboard actions and treats copy separately", () => {
  const report = vi.fn();
  const monitor = createRuleMonitor(
    { clipboard: "penalty", copy: "announce", focus: "off" },
    report,
  );
  expect(monitor.clipboard()).toBe(false);
  expect(monitor.clipboard("copy")).toBe(false);
  expect(report.mock.calls).toEqual([
    ["clipboard", "penalty"],
    ["copy", "announce"],
  ]);
});
it("ignores brief focus loss and cancels pending reports on disposal", () => {
  vi.useFakeTimers();
  try {
    const report = vi.fn();
    const monitor = createRuleMonitor(
      { clipboard: "off", focus: "penalty", focusGraceSeconds: 3 },
      report,
    );
    monitor.focus(false);
    vi.advanceTimersByTime(2999);
    monitor.focus(true);
    vi.advanceTimersByTime(1);
    expect(report).not.toHaveBeenCalled();
    monitor.focus(false);
    vi.advanceTimersByTime(3000);
    expect(report).toHaveBeenCalledTimes(1);
    monitor.focus(true);
    monitor.focus(false);
    monitor.dispose();
    vi.advanceTimersByTime(3000);
    expect(report).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
