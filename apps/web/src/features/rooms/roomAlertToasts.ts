/** @file roomAlertToasts.ts @description Updates active alerts and recreates closed alerts. @module rooms */
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { useChangeMotion } from "../../ui/useChangeMotion";

function RoomToastMessage({ message, returned }: { message: ReactNode; returned: boolean }) {
  const ref = useChangeMotion<HTMLSpanElement>(Number(returned));
  return createElement("span", { ref }, message);
}

export function createRoomAlertToasts() {
  const active = new Map<string, string | number>();
  return {
    show(key: string, message: ReactNode, returned = false, icon?: ReactNode) {
      const clear = () => active.delete(key);
      const id = toast.warning(createElement(RoomToastMessage, { message, returned }), {
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
