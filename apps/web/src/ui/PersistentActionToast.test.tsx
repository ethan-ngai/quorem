// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PersistentActionToast } from "./PersistentActionToast";
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));
it("minimizes, reopens and dismisses on unmount without stealing editor focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const editor = document.createElement("input");
  const trigger = document.createElement("div");
  const notification = document.createElement("div");
  document.body.append(editor, trigger, notification);
  const root = createRoot(trigger);
  const toastRoot = createRoot(notification);
  editor.focus();
  await act(async () =>
    root.render(
      <PersistentActionToast noun="vote" id="vote" title="Submit code">
        <p>Vote content</p>
      </PersistentActionToast>,
    ),
  );
  expect(document.activeElement).toBe(editor);
  const [title, options] = vi.mocked(toast).mock.calls.at(-1)!;
  expect(options).toMatchObject({ duration: Infinity, dismissible: false, closeButton: false });
  await act(async () =>
    toastRoot.render(
      <>
        {title as ReactNode}
        {options?.description as ReactNode}
      </>,
    ),
  );
  await act(async () =>
    notification.querySelector<HTMLButtonElement>('[aria-label="Minimize vote"]')!.click(),
  );
  expect(toast.dismiss).toHaveBeenCalledWith("vote");
  expect(trigger.textContent).toContain("Show vote");
  const count = vi.mocked(toast).mock.calls.length;
  await act(async () => trigger.querySelector("button")!.click());
  expect(vi.mocked(toast).mock.calls.length).toBe(count + 1);
  expect(trigger.textContent).toContain("Vote pending");
  vi.mocked(toast.dismiss).mockClear();
  await act(async () => root.unmount());
  expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith("vote");
  await act(async () => toastRoot.unmount());
  editor.remove();
  trigger.remove();
  notification.remove();
  vi.unstubAllGlobals();
});
