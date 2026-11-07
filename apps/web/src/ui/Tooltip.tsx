import "./tooltip.css";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Children, useEffect, useState, type ReactElement, type ReactNode } from "react";

/** Shared keyboard-accessible hint; portals avoid pane clipping. */
export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
  open: controlledOpen,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
  open?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const enabled =
    !disabled &&
    Children.toArray(content).some((node) => typeof node !== "string" || node.trim() !== "");
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  return (
    <RadixTooltip.Provider delayDuration={100} disableHoverableContent>
      <RadixTooltip.Root
        open={enabled && (controlledOpen ?? open)}
        onOpenChange={enabled ? setOpen : undefined}
      >
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            className="workspace-tooltip"
            side={side}
            sideOffset={6}
            collisionPadding={8}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
