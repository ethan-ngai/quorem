/** @file NotificationBell.tsx @description On-demand inbox with an account-scoped unread badge. @module notifications */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, Settings, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { Inbox, InboxItem } from "@quorem/contracts/notifications";
import * as Popover from "../../ui/Popover";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { LoadingButton } from "../../ui/LoadingButton";
import { Tooltip } from "../../ui/Tooltip";
import { useChangeMotion } from "../../ui/useChangeMotion";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { participantColor } from "../collaboration/participantColor";
import { matchModeLabels, ModeIcon } from "../matches/ModeIcon";
import { partyCommand } from "../matches/party";
import {
  changeFriend,
  dismissNotification,
  friendsKey,
  getUnread,
  inboxChanged,
  inboxKey,
  inboxOpen,
  openInbox,
} from "./api";
import { useSwipeToDelete } from "./useSwipeToDelete";
import "./notifications.css";

const deleteIconSize = 11;
const notificationActions = [
  { action: "accept", icon: Check, label: "Accept", size: 16 },
  { action: "decline", icon: X, label: "Decline", size: 16 },
  { action: "delete", icon: Trash2, label: "Delete", size: deleteIconSize },
] as const;

function UnreadBadge({ count }: { count: number }) {
  // Keep the last number visible until the badge finishes clearing.
  const [displayCount, setDisplayCount] = useState(count);
  if (count > 0 && count !== displayCount) setDisplayCount(count);
  const motion = useChangeMotion<HTMLSpanElement>(displayCount);
  return (
    <span className="notification-badge" aria-hidden="true" data-visible={count > 0}>
      <span ref={motion}>{displayCount}</span>
    </span>
  );
}

type NotificationAction = (typeof notificationActions)[number]["action"];

function NotificationRow({
  item,
  disabled,
  pending,
  error,
  onAction,
}: {
  item: InboxItem;
  disabled: boolean;
  pending?: NotificationAction;
  error?: string;
  onAction: (action: NotificationAction) => Promise<void>;
}) {
  const swipe = useSwipeToDelete(disabled, () => onAction("delete"));
  const mode = item.mode ?? "showdown";
  return (
    <>
      <div className="notification-swipe-scroll" {...swipe.scroll}>
        <div className="notification-swipe-track">
          <span className="notification-swipe-start" aria-hidden="true" />
          <span className="notification-swipe-end" aria-hidden="true" />
          <div className="notification-row action-reveal-group" {...swipe.row}>
            <AccountAvatar
              name={item.sender.displayName}
              image={item.sender.image}
              color={participantColor(item.sender.id, item.sender.color)}
            />
            <div className="notification-description">
              <strong title={item.sender.displayName}>{item.sender.displayName}</strong>
              <span className="notification-type">
                {item.kind === "match_invite" ? (
                  <>
                    <ModeIcon mode={mode} />
                    {matchModeLabels[mode]} invite
                  </>
                ) : (
                  <>
                    <UserPlus aria-hidden="true" />
                    Friend request
                  </>
                )}
              </span>
            </div>
            {notificationActions.map(({ action, icon: ActionIcon, label, size }) => (
              <Tooltip key={action} content={label} side={action === "delete" ? "right" : "top"}>
                <LoadingButton
                  type="button"
                  className={`icon-button notification-${action}${action === "accept" ? "" : " destructive-icon"}`}
                  aria-label={`${label} · ${item.sender.displayName}`}
                  data-reveal={action === "delete" ? "" : undefined}
                  disabled={disabled}
                  pending={pending === action}
                  iconSize={size}
                  icon={<ActionIcon size={size} aria-hidden="true" />}
                  onClick={() => void onAction(action).catch(() => {})}
                />
              </Tooltip>
            ))}
            <span className="notification-swipe-fill" aria-hidden="true">
              <Trash2 size={deleteIconSize} />
            </span>
          </div>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function NotificationBell({ actor, settings }: { actor: string; settings: () => void }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const key = inboxKey(actor);
  const unreadKey = [...key, "unread"];
  const unread = useQuery({
    queryKey: unreadKey,
    queryFn: ({ signal }) => getUnread(signal),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const inbox = useQuery({
    queryKey: [...key, "items"],
    queryFn: ({ signal }) => openInbox(signal),
    enabled: open,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  useEffect(() => {
    if (open && inbox.data)
      client.setQueryData([...inboxKey(actor), "unread"], { unread: inbox.data.unread });
  }, [actor, client, inbox.data, open]);

  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: inboxKey(actor) });
      void client.invalidateQueries({ queryKey: friendsKey(actor) });
    };
    const show = () => setOpen(true);
    const onMessage = (event: MessageEvent) => {
      if (event.data === inboxChanged) refresh();
      if (event.data === inboxOpen) {
        refresh();
        show();
      }
    };
    const url = new URL(location.href);
    if (url.searchParams.has("notifications")) {
      url.searchParams.delete("notifications");
      history.replaceState(history.state, "", url);
      show();
    }
    window.addEventListener(inboxChanged, refresh);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(inboxChanged, refresh);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [actor, client]);

  const update = useMutation({
    mutationFn: async ({ item, action }: { item: InboxItem; action: NotificationAction }) => {
      if (action === "delete" || (action === "decline" && item.kind === "match_invite")) {
        await dismissNotification(item.id);
      } else if (item.kind === "friend_request") {
        await changeFriend(item.sender.id, action);
      } else {
        await partyCommand(
          actor as DevelopmentIdentity,
          `/v1/notifications/${item.id}/accept-invite`,
        );
        void client.invalidateQueries({ queryKey: ["current-party", actor] });
        setOpen(false);
        await navigate({ to: "/party" });
      }
    },
    onSuccess: async (_, { item, action }) => {
      if (action === "delete") {
        client.setQueryData<Inbox>(
          [...key, "items"],
          (previous) =>
            previous && { ...previous, items: previous.items.filter(({ id }) => id !== item.id) },
        );
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: friendsKey(actor) }),
      ]);
    },
  });

  const count = unread.data?.unread ?? 0;
  const deleting =
    update.isPending && update.variables?.action === "delete"
      ? update.variables.item.id
      : undefined;
  const items = inbox.data?.items.filter(({ id }) => id !== deleting);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications" disabled={open}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="icon-button notification-trigger"
            aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
          >
            <Bell size={18} aria-hidden="true" />
            <UnreadBadge count={count} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="notification-popover" align="end" aria-label="Notifications">
          <header>
            <h2>Notifications</h2>
            <Tooltip content="Notification settings">
              <button
                type="button"
                className="icon-button"
                aria-label="Notification settings"
                onClick={() => {
                  setOpen(false);
                  settings();
                }}
              >
                <Settings size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </header>
          {inbox.isPending && <p role="status">Loading notifications…</p>}
          {inbox.isError && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void inbox.refetch()}
            >
              Retry loading notifications
            </button>
          )}
          {items?.length === 0 && <p>No notifications.</p>}
          {items && (
            <AnimatedRows
              as="ul"
              className="notification-items"
              items={items}
              getKey={(item) => item.id}
              renderRow={(item) => {
                const current = update.variables?.item.id === item.id;
                return (
                  <NotificationRow
                    item={item}
                    disabled={update.isPending}
                    pending={current && update.isPending ? update.variables?.action : undefined}
                    error={current && update.isError ? update.error.message : undefined}
                    onAction={(action) => update.mutateAsync({ item, action })}
                  />
                );
              }}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
