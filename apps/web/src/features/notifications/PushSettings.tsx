/** @file PushSettings.tsx @description Per-type push preferences and browser permission controls. @module notifications */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { NotificationKind, PushPreferences } from "@quorem/contracts/notifications";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { LoadingButton } from "../../ui/LoadingButton";
import {
  getNotificationSettings,
  removePushSubscription,
  savePushPreferences,
  savePushSubscription,
} from "./api";

const labels: Record<NotificationKind, string> = {
  friend_request: "Friend requests",
  match_invite: "Match invites",
};
const kinds = Object.keys(labels) as NotificationKind[];
const permission = () =>
  typeof Notification !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof PushManager !== "undefined"
    ? Notification.permission
    : "unsupported";

export function PushSettings({ actor }: { actor: string }) {
  const client = useQueryClient();
  const key = ["push-settings", actor];
  const config = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getNotificationSettings(signal),
  });
  const [state, setState] = useState(permission);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    function refresh() {
      setState(permission());
      if (permission() === "unsupported") return;
      void navigator.serviceWorker
        .getRegistration("/")
        .then(async (registration) =>
          setEnabled(!!(await registration?.pushManager.getSubscription())),
        )
        .catch(() => setEnabled(false));
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const save = useMutation({
    mutationFn: savePushPreferences,
    onSuccess: (_, preferences: PushPreferences) => {
      if (config.data) client.setQueryData(key, { ...config.data, preferences });
    },
  });
  const device = useMutation({
    mutationFn: async () => {
      if (!config.data?.publicKey) return;
      const result =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      setState(result);
      if (result !== "granted") return;
      const registration = await navigator.serviceWorker.register("/notification-worker.js");
      const worker = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (enabled && existing) {
        await removePushSubscription(existing.endpoint);
        await existing.unsubscribe();
        setEnabled(false);
        return;
      }
      const subscription =
        existing ??
        (await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(
            atob(config.data.publicKey.replaceAll("-", "+").replaceAll("_", "/")),
            (byte) => byte.charCodeAt(0),
          ),
        }));
      await savePushSubscription(subscription.toJSON());
      setEnabled(true);
    },
  });
  return (
    <>
      <p>Choose which notifications also appear on this device. All types appear in your inbox.</p>
      {config.isPending && <p role="status">Loading preferences…</p>}
      {config.isError && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void config.refetch()}
        >
          Retry loading preferences
        </button>
      )}
      {config.data && (
        <>
          {kinds.map((kind) => (
            <div className="notification-setting" key={kind}>
              <span>{labels[kind]}</span>
              <ToggleSwitch
                label={labels[kind]}
                checked={config.data.preferences[kind]}
                disabled={save.isPending}
                onChange={(checked) => {
                  if (config.data) save.mutate({ ...config.data.preferences, [kind]: checked });
                }}
              />
            </div>
          ))}
          {state === "denied" && (
            <p>
              Notifications are blocked. Allow them in your browser’s site settings, then return
              here.
            </p>
          )}
          {state === "unsupported" && (
            <p>
              Push is unavailable in this browser. On iPhone or iPad, open Quorem from the Home
              Screen.
            </p>
          )}
          {state !== "unsupported" && state !== "denied" && config.data.publicKey && (
            <LoadingButton
              type="button"
              className="button button-secondary"
              pending={device.isPending}
              onClick={() => device.mutate()}
            >
              {enabled
                ? "Disable push on this device"
                : state === "default"
                  ? "Ask for notification permission"
                  : "Enable push on this device"}
            </LoadingButton>
          )}
          {!config.data.publicKey && <p>Push is unavailable in this environment.</p>}
          {(save.isError || device.isError) && (
            <p role="alert">Could not update notifications. Try again.</p>
          )}
        </>
      )}
    </>
  );
}
