/** @file PersistentActionToast.tsx @description Persistent actionable notifications with a recoverable minimized state. @module ui */
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Minus } from "lucide-react";
import { Tooltip } from "./Tooltip";
import "./persistent-action-toast.css";
export function PersistentActionToast({
  id,
  title,
  children,
  noun = "action",
  icon,
}: {
  id: string;
  title: string;
  children: ReactNode;
  noun?: string;
  icon?: ReactNode;
}) {
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (minimized) {
      toast.dismiss(id);
      return;
    }
    toast(
      <div className="persistent-action-toast-heading">
        <span>{title}</span>
        <Tooltip content={`Minimize ${noun}`}>
          <button
            type="button"
            className="quiet-button persistent-action-toast-minimize"
            aria-label={`Minimize ${noun}`}
            onClick={() => setMinimized(true)}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>,
      {
        id,
        className: "app-toast persistent-action-toast-shell",
        duration: Infinity,
        dismissible: false,
        closeButton: false,
        description: <div className="persistent-action-toast">{children}</div>,
      },
    );
  }, [id, title, children, minimized, noun]);
  useEffect(
    () => () => {
      toast.dismiss(id);
    },
    [id],
  );
  return (
    <button
      type="button"
      className="quiet-button persistent-action-toast-trigger"
      onClick={() => setMinimized(false)}
      aria-label={`Show ${title}`}
    >
      {icon}
      {minimized ? `Show ${noun}` : `${noun[0]?.toUpperCase()}${noun.slice(1)} pending`}
    </button>
  );
}
