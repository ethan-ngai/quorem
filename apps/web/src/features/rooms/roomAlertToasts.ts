/** @file roomAlertToasts.ts @description Updates active alerts and recreates closed alerts. @module rooms */
import type { ReactNode } from "react";
import { toast } from "sonner";

export function createRoomAlertToasts() {
  const active = new Map<string, string | number>();
  return {
    show(key: string, message: ReactNode, returned = false, icon?: ReactNode) {
      const clear = () => active.delete(key);
      const id = toast.warning(message, {
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
