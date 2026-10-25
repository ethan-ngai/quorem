/** Observe the page theme without giving illustrative editors ownership of it. */
import { useSyncExternalStore } from "react";

function subscribe(update: () => void) {
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
function getTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
export function usePreviewTheme() {
  return useSyncExternalStore<"light" | "dark">(subscribe, getTheme, () => "light");
}
