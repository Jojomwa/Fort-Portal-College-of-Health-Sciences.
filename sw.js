/* ACMIS Service Worker - background push notifications */

const CACHE_NAME = "acmis-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      data = {
        body: event.data ? event.data.text() : ""
      };
    } catch (_) {}
  }

  const title =
    data.title ||
    data.subject ||
    "ACMIS Notification";

  const body =
    data.body ||
    "You have a new notification from ACMIS.";

  const url =
    data.url ||
    "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: data.icon || "/icon-192.png",
      badge: data.badge || "/icon-192.png",
      data: {
        url: url
      },
      tag: data.tag || "acmis-notification",
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    event.notification.data &&
    event.notification.data.url
      ? event.notification.data.url
      : "/";

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true
      })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            try {
              client.navigate(url);
            } catch (_) {}

            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The ACMIS page will save the current subscription
  // when the student opens the portal again.
});
