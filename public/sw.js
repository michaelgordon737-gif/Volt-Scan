const CACHE = "backyard-cornhole-v4";
const ASSETS = ["/cornhole.css?v=4","/cornhole.js?v=4","/manifest.json","/icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>k!==CACHE && caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  event.respondWith(
    fetch(event.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
self.addEventListener("message", event => {
  const d = event.data || {};
  if (d.type === "SHOW_NOTIFICATION") {
    self.registration.showNotification(d.title || "Cornhole", {
      body: d.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "cornhole",
      renotify: true
    });
  }
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow("/");
  }));
});
