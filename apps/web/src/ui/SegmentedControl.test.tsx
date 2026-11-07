// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

it("skips unavailable choices when navigating with arrows, Home and End", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn();
  function Subject() {
    const [value, setValue] = useState("two");
    return (
      <SegmentedControl
        label="Mode"
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
        options={[
          { value: "one", label: "One", disabled: true },
          { value: "two", label: "Two" },
          { value: "three", label: "Three" },
          { value: "four", label: "Four", disabled: true },
        ]}
      />
    );
  }
  await act(async () => root.render(<Subject />));
  const buttons = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  expect(buttons[0]!.disabled).toBe(true);
  await act(async () => buttons[1]!.click());
  expect(changed).not.toHaveBeenCalled();
  buttons[1]!.focus();
  await act(async () =>
    buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
  );
  expect(changed).not.toHaveBeenCalled();
  for (const [key, index] of [
    ["ArrowLeft", 2],
    ["Home", 1],
    ["End", 2],
    ["ArrowRight", 1],
  ] as const) {
    await act(async () =>
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
    );
    expect(document.activeElement).toBe(buttons[index]);
    expect(buttons[index]!.getAttribute("aria-checked")).toBe("true");
  }
  expect(changed.mock.calls).toEqual([["three"], ["two"], ["three"], ["two"]]);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
