// Guarda el juego y las muestras del piano para que abra rápido y funcione sin conexión.
const CACHE = "tasti-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/rest/v1/")) return; // la biblioteca y las clasificaciones, siempre frescas
  const immutable = url.pathname.startsWith("/assets/") || url.host === "tonejs.github.io";
  if (immutable) {
    // archivos con nombre fijo para siempre: primero la copia guardada
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (url.origin === location.origin) {
    // la página y las piezas: primero la red, y si no hay, lo guardado
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
  }
});
