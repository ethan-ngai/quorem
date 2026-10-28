import "./tooltip.css";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";

/** Shared keyboard-accessible hint; portals avoid pane clipping. */
export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <RadixTooltip.Provider delayDuration={100}>
      <RadixTooltip.Root open={!disabled && open} onOpenChange={setOpen}>
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
