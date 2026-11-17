/** @file roomAlertToasts.tsx @description Updates active alerts and recreates closed alerts. @module rooms */
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ContentTransition } from "../../ui/ContentTransition";
import "./room-alerts.css";

type RoomToastOptions = {
  returned?: boolean;
  icon?: ReactNode;
  prefix?: ReactNode;
  details?: ReactNode;
};

export function createRoomAlertToasts() {
  const active = new Map<string, string | number>();
  return {
    show(
      key: string,
      message: ReactNode,
      { returned, icon, prefix, details }: RoomToastOptions = {},
    ) {
      const clear = () => active.delete(key);
      const title = (
        <div className="room-toast-title">
          {prefix && <span>{prefix}</span>}
          <ContentTransition
            contentKey={returned ? "returned" : "initial"}
            slideUp
            durationMs={280}
          >
            <div>{message}</div>
          </ContentTransition>
          {details}
        </div>
      );
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
