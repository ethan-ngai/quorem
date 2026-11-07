// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChoiceMatrix } from "./ChoiceMatrix";

it("keeps row selections independent and exposes specific action labels", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Subject({ disabled = false }: { disabled?: boolean }) {
    const [values, setValues] = useState({ copy: "allow", focus: "allow" });
    return (
      <ChoiceMatrix
        label="Policies"
        disabled={disabled}
        columns={[
          { value: "allow", label: "Allow" },
          { value: "restrict", label: "Restrict" },
        ]}
        rows={[
          { key: "copy", label: "Copy", value: values.copy, labels: { restrict: "Block" } },
          { key: "focus", label: "Focus", value: values.focus, labels: { restrict: "Warn" } },
        ]}
        onChange={(row, value) => setValues((current) => ({ ...current, [row]: value }))}
      />
    );
  }
  await act(async () => root.render(<Subject />));
  const block = container.querySelector<HTMLInputElement>('[aria-label="Copy: Block"]')!;
  const focus = container.querySelector<HTMLInputElement>('[aria-label="Focus: Allow"]')!;
  await act(async () => block.click());
  expect(block.checked).toBe(true);
  expect(focus.checked).toBe(true);
  expect(block.name).not.toBe(focus.name);
  await act(async () => root.render(<Subject disabled />));
  expect([...container.querySelectorAll("input")].every((input) => input.disabled)).toBe(true);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
