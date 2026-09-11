/* Push-уведомления: подключается в сервис-воркер сборки (workbox importScripts). Показывает уведомление
   с текстом от сервера и по клику открывает нужную страницу в уже открытой вкладке или в новой. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Земли Слова";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/img/brand/logo-64.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ("focus" in c) { if ("navigate" in c) c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
