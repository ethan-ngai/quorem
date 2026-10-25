import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SessionDialog } from "./SessionDialog";

const handlers = vi.hoisted(() => ({
  change: (_open: boolean) => {},
  focus: (_event: Event) => {},
}));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => {
    handlers.change = onOpenChange;
    return children;
  },
  Portal: ({ children }: { children: ReactNode }) => children,
  Overlay: () => null,
  Content: ({
    children,
    onOpenAutoFocus,
  }: {
    children: ReactNode;
    onOpenAutoFocus: (event: Event) => void;
  }) => {
    handlers.focus = onOpenAutoFocus;
    return <section>{children}</section>;
  },
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Close: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./Tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

it("owns pending dismissal lock and preserves explicit accessible close labels", () => {
  const onOpenChange = vi.fn();
  const render = (pending: boolean) =>
    renderToStaticMarkup(
      <SessionDialog
        open
        pending={pending}
        onOpenChange={onOpenChange}
        title="Leave?"
        description="Confirm leaving"
        closeLabel="Close forfeit dialog"
      >
        <button>Keep playing</button>
      </SessionDialog>,
    );
  const html = render(true);
  expect(html).toContain('aria-label="Close forfeit dialog" disabled=""');
  handlers.change(false);
  expect(onOpenChange).not.toHaveBeenCalled();
  render(false);
  handlers.change(false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("focuses the provided least destructive action without scrolling", () => {
  const focus = vi.fn();
  const initialFocus = { current: { focus } as unknown as HTMLElement };
  renderToStaticMarkup(
    <SessionDialog
      open
      onOpenChange={() => {}}
      title="Leave?"
      description="Confirm leaving"
      initialFocus={initialFocus}
    >
      <button>Keep playing</button>
    </SessionDialog>,
  );
  const event = new Event("openAutoFocus", { cancelable: true });
  handlers.focus(event);
  expect(event.defaultPrevented).toBe(true);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
