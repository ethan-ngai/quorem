/** @file Notifications.tsx @description Theme-aware Sonner host and deduplicated transient errors. @module ui */
import { useEffect, useId } from "react";
import { Toaster, toast } from "sonner";
// Match Dialog/Popover's dependency version so outside-click context is shared.
import { Branch } from "@radix-ui/react-dismissable-layer";
import "./notifications.css";

export function Notifications({ id }: { id?: string }) {
  return (
    <Branch>
      <Toaster
        id={id}
        position="top-right"
        closeButton
        duration={7000}
        visibleToasts={3}
        offset={64}
        mobileOffset={{ top: 64, left: 16, right: 16 }}
        toastOptions={{ className: "app-toast", closeButtonAriaLabel: "Dismiss notification" }}
      />
    </Branch>
  );
}

/** Stable IDs prevent duplicate notifications from rerenders and repeated recovery polls. */
export function useErrorNotification(message: string | undefined, toasterId?: string) {
  const id = useId();
  useEffect(() => {
    if (message) toast.error(message, { id, toasterId });
  }, [message, id, toasterId]);
}
