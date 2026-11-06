/** @file Notifications.tsx @description Theme-aware Sonner host and deduplicated transient errors. @module ui */
import { useEffect, useId, type MouseEvent } from "react";
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

/** Completion feedback stays out of form layout. */
export function useSuccessNotification(message: string | undefined) {
  const id = useId();
  useEffect(() => {
    if (message) toast.success(message, { id });
  }, [message, id]);
}

/** Release Sonner's focus restoration before opening another overlay. */
export function notificationAction(label: string, onClick: () => void) {
  return {
    label,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.currentTarget.blur();
      requestAnimationFrame(onClick);
    },
  };
}

/** Zero counts stay implicit; failures expose details without expanding the page. */
export function notifyBatchResult({
  id,
  verb,
  noun,
  succeeded,
  failed,
  onDetails,
}: {
  id: string | number;
  verb: string;
  noun: string;
  succeeded: number;
  failed: number;
  onDetails?: () => void;
}) {
  if (!succeeded && !failed) {
    toast.dismiss(id);
    return;
  }
  const items = (count: number) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const title = succeeded
    ? `${verb} ${items(succeeded)}`
    : `${items(failed)} ${failed === 1 ? "needs" : "need"} attention`;
  const options = {
    id,
    ...(succeeded && failed ? { description: `${failed} need attention.` } : {}),
    ...(failed && onDetails ? { action: notificationAction("Details", onDetails) } : {}),
  };
  if (!failed) toast.success(title, options);
  else if (succeeded) toast.warning(title, options);
  else toast.error(title, options);
}
