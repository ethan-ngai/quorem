/** @file api.ts @description Account-scoped inbox, contacts and browser subscription requests. @module notifications */
import type { PushPreferences } from "@quorem/contracts/notifications";
import type { paths } from "@quorem/contracts/schema";
import { api, requireData } from "../../api/client";

export const inboxChanged = "quorem:inbox-changed";
export const inboxOpen = "quorem:inbox-open";
export const inboxKey = (actor: string) => ["notifications", actor] as const;
export const friendsKey = (actor: string) => ["friends", actor] as const;
export const notifyInbox = () => window.dispatchEvent(new Event(inboxChanged));

function result<T>({ data, error, response }: { data?: T; error?: unknown; response: Response }) {
  return requireData(data, error, response.status);
}

export const getUnread = (signal?: AbortSignal) =>
  api().GET("/v1/notifications/unread", { signal }).then(result);
export const openInbox = (signal?: AbortSignal) =>
  api().POST("/v1/notifications/open", { signal }).then(result);
export const dismissNotification = (id: string) =>
  api()
    .DELETE("/v1/notifications/{id}", { params: { path: { id } } })
    .then(result);
export const getFriends = (signal?: AbortSignal) =>
  api().GET("/v1/friends", { signal }).then(result);
export const getFriend = (player: string, signal?: AbortSignal) =>
  api()
    .GET("/v1/friends/{player}", { params: { path: { player } }, signal })
    .then(result);
type FriendAction =
  paths["/v1/friends/{player}"]["post"]["requestBody"]["content"]["application/json"]["action"];
export const changeFriend = (player: string, action: FriendAction) =>
  api()
    .POST("/v1/friends/{player}", { params: { path: { player } }, body: { action } })
    .then(result);
export const inviteFriend = (party: string, player: string) =>
  api()
    .POST("/v1/parties/{party}/direct-invitations", {
      params: { path: { party } },
      body: { player },
    })
    .then(result);
export const getNotificationSettings = (signal?: AbortSignal) =>
  api().GET("/v1/notifications/settings", { signal }).then(result);
export const savePushPreferences = (body: PushPreferences) =>
  api().PUT("/v1/notifications/settings", { body }).then(result);
export const savePushSubscription = ({ endpoint, keys }: PushSubscriptionJSON) =>
  api()
    .PUT("/v1/notifications/push-subscription", {
      body: { endpoint: endpoint ?? "", p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
    })
    .then(result);
export const removePushSubscription = (endpoint: string) =>
  api().DELETE("/v1/notifications/push-subscription", { body: { endpoint } }).then(result);
