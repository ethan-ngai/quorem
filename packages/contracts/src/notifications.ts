/** @file notifications.ts @description Shared inbox types derived from the HTTP contract. @module contracts */
import type { components } from "./generated.ts";

type Schemas = components["schemas"];

export type NotificationKind = Schemas["NotificationKind"];
export type SocialContact = Schemas["SocialContact"];
export type ContactState = Schemas["ContactState"];
export type InboxItem = Schemas["InboxItem"];
export type Inbox = Schemas["NotificationInbox"];
export type PushPreferences = Schemas["PushPreferences"];
export type NotificationSettings = Schemas["NotificationSettings"];

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
