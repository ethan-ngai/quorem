/** @file shareInvitation.ts @description Competitive invitation metadata for the shared native-share primitive. @module matches */
import { shareLink, type ShareBrowser } from "../../ui/shareLink";
export function shareInvitation(url: string, browser: ShareBrowser = navigator) {
  return shareLink(
    { title: "Quorem match", text: "Join my coding match on Quorem.", url },
    browser,
  );
}
