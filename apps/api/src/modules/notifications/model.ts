/** @file model.ts @description Account-scoped social commands and notification delivery ports. @module notifications */
import type {
  BrowserPushSubscription,
  ContactState,
  Inbox,
  PushPreferences,
  SocialContact,
} from "@quorem/contracts/notifications";
import type { Principal } from "../identity/model.ts";

export type FriendAction = "request" | "accept" | "decline" | "remove" | "block" | "unblock";
export type NotificationChange = { owner: string; id?: string };

export interface Notifications {
  inbox(owner: string, markRead: boolean): Promise<Inbox>;
  unread(owner: string): Promise<number>;
  dismiss(owner: string, id: string): Promise<void>;
  contacts(owner: string): Promise<SocialContact[]>;
  contact(owner: string, player: string): Promise<ContactState>;
  friend(
    owner: string,
    player: string,
    action: FriendAction,
  ): Promise<NotificationChange | undefined>;
  invite(owner: string, party: string, player: string): Promise<NotificationChange | undefined>;
  preferences(owner: string): Promise<PushPreferences>;
  setPreferences(owner: string, value: PushPreferences): Promise<void>;
  subscribe(owner: string, subscription: BrowserPushSubscription): Promise<void>;
  unsubscribe(owner: string, endpoint: string): Promise<void>;
}

export type AcceptInvitation = (who: Principal, key: string, id: string) => Promise<unknown>;
