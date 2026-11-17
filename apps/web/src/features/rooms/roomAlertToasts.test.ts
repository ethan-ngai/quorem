/** @file roomAlertToasts.test.ts @description Toast update and recreation regressions. @module rooms */
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createRoomAlertToasts } from "./roomAlertToasts";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), dismiss: vi.fn() } }));

it.each(["onAutoClose", "onDismiss"] as const)(
  "updates a visible departure and reopens a closed one (%s)",
  (close) => {
    const warning = vi.mocked(toast.warning);
    warning.mockReset();
    let nextId = 1;
    warning.mockImplementation((_message, options) => options?.id ?? nextId++);
    const toasts = createRoomAlertToasts();

    toasts.show("first", "Alice left");
    toasts.show("first", "Alice returned after 5s away", { returned: true });
    expect(warning.mock.lastCall?.[1]?.id).toBe(1);

    toasts.show("second", "Bob left");
    warning.mock.lastCall?.[1]?.[close]?.({ id: 2 });
    toasts.show("second", "Bob returned after 30s away", { returned: true });
    expect(warning.mock.lastCall?.[1]?.id).toBeUndefined();

    toasts.dismissAll();
    expect(toast.dismiss).toHaveBeenCalledWith(3);
  },
);
