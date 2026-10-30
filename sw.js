// Offline-Betrieb: die App-Dateien liegen im Handy, damit sie auch ohne Netz startet.
// Gesendet wird nur aus der App heraus (Warteschlange), nicht hier.
const VERSION = 'hof-app-v10';
const DATEIEN = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'js/paket.js', 'js/speicher.js', 'js/briefkasten.js', 'js/sprache.js', 'js/erkennung.js', 'js/wav.js', 'js/modus.js', 'js/funktionen.js', 'js/post.js', 'js/post-ansicht.js', 'funktionen.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // 'reload': frisch vom Server holen, nicht aus dem Zwischenspeicher des Browsers (GitHub Pages erlaubt dort 10 Minuten).
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(DATEIEN.map(u => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst Netz (damit Updates sofort ankommen), sonst aus dem Speicher.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Bei schwachem Netz nach 3 Sekunden die gespeicherte Fassung nehmen.
  e.respondWith((async () => {
    const netz = fetch(e.request, { cache: 'no-cache' }).then(r => { // 'no-cache': beim Server nachfragen, ob es Neues gibt
      if (r.ok) { const k = r.clone(); caches.open(VERSION).then(c => c.put(e.request, k)); }
      return r;
    });
    const gespeichert = await caches.match(e.request, { ignoreSearch: true });
    if (!gespeichert) return netz;
    const zeit = new Promise(ok => setTimeout(() => ok(gespeichert), 3000));
    return Promise.race([netz.catch(() => gespeichert), zeit]);
  })());
});
