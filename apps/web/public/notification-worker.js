/* Push payloads carry a notification identifier and type, never account or lobby details. */
self.addEventListener("push", (event) => {
  const data = event.data?.json();
  if (!data || typeof data.id !== "string") return;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification("Quorem", {
        body:
          data.kind === "friend_request"
            ? "You have a new friend request."
            : "You have a new match invite.",
        icon: "/icon-192.png",
        tag: data.id,
      }),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage("quorem:inbox-changed"))),
    ]),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL("/social?notifications=1", self.location.origin).href;
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const workspaceTabs = clients.filter((client) =>
        /^\/(?:home|practice|social|players|party|match|interview|interviews)(?:\/|$)/.test(
          new URL(client.url).pathname,
        ),
      );
      const existing =
        workspaceTabs.find((client) => client.visibilityState === "visible") ?? workspaceTabs[0];
      if (existing) {
        existing.postMessage("quorem:inbox-open");
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
