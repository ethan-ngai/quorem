// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LoadingButton } from "./LoadingButton";

it("locks immediately, skips short loads and replaces the icon after 200 ms", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const onClick = vi.fn();
  const render = (pending: boolean, retainFocus = false) =>
    act(async () => {
      root.render(
        <StrictMode>
          <LoadingButton
            type="button"
            icon={<span data-original-icon />}
            pending={pending}
            aria-disabled={retainFocus ? false : undefined}
            onClick={onClick}
          >
            Submit
          </LoadingButton>
        </StrictMode>,
      );
    });
  const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
  const button = () => container.querySelector("button")!;
  const icon = () => button().querySelector(".state-icon")!;
  try {
    await render(true);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    await advance(199);
    expect(icon().getAttribute("data-active")).toBe("false");
    await render(false);
    await advance(1);
    expect(icon().getAttribute("data-active")).toBe("false");

    await render(true, true);
    expect(button().disabled).toBe(false);
    expect(button().getAttribute("aria-disabled")).toBe("true");
    button().click();
    expect(onClick).not.toHaveBeenCalled();
    await advance(199);
    expect(icon().getAttribute("data-active")).toBe("false");
    await advance(1);
    expect(icon().getAttribute("data-active")).toBe("true");
    expect(icon().querySelector(".state-icon-off [data-original-icon]")).not.toBeNull();
    expect(button().textContent).toBe("Submit");

    await render(false, true);
    expect(icon().getAttribute("data-active")).toBe("false");
    button().click();
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
