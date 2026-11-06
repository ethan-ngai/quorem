// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AuthoringTabs } from "./AuthoringTabs";

it("moves selection and focus with arrow, Home and End keys", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Subject() {
    const [selected, setSelected] = useState("one");
    return (
      <AuthoringTabs
        label="Choices"
        value={selected}
        onChange={setSelected}
        tabs={[
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
          { value: "three", label: "Three" },
        ]}
      />
    );
  }
  await act(async () => root.render(<Subject />));
  const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs[0]!.focus();
  await act(async () =>
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[2]);
  expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    tabs[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[0]);
  await act(async () =>
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[2]);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
