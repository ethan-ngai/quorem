/** Shared anchored overlays retain Radix focus/dismissal behavior and one motion policy. */
import * as RadixPopover from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import "./popover.css";

export { Root, Trigger, Portal, Anchor, Arrow, Close } from "@radix-ui/react-popover";

export function Content({
  className = "",
  sideOffset = 8,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Content
      {...props}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={`ui-popover ${className}`}
    />
  );
}
