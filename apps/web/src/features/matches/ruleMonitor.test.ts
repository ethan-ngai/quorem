import { describe, expect, it, vi } from "vitest";
import { createRuleMonitor } from "./ruleMonitor";

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
