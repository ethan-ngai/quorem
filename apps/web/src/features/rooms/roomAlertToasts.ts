/** @file roomAlertToasts.ts @description Updates active alerts and recreates closed alerts. @module rooms */
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { ContentTransition } from "../../ui/ContentTransition";

export function createRoomAlertToasts() {
  const active = new Map<string, string | number>();
  return {
    show(key: string, message: ReactNode, returned = false, icon?: ReactNode) {
      const clear = () => active.delete(key);
      const title = createElement(ContentTransition, {
        contentKey: returned ? "returned" : "initial",
        durationMs: 280,
        children: createElement("span", null, message),
      });
      const id = toast.warning(title, {
        id: active.get(key),
        icon,
        duration: returned ? 8000 : undefined,
        onDismiss: clear,
        onAutoClose: clear,
      });
      active.set(key, id);
    },
    dismissAll() {
      for (const id of active.values()) toast.dismiss(id);
      active.clear();
    },
  };
}
