// Offline-Betrieb: die App-Dateien liegen im Handy, damit sie auch ohne Netz startet.
// Gesendet wird nur aus der App heraus (Warteschlange), nicht hier.
const VERSION = 'hof-app-v27';
const DATEIEN = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'js/paket.js', 'js/speicher.js', 'js/briefkasten.js', 'js/sprache.js', 'js/erkennung.js', 'js/wav.js', 'js/modus.js', 'js/funktionen.js', 'js/post.js', 'js/post-ansicht.js', 'js/anmelden.js', 'js/bestaetigung-ansicht.js', 'js/uebersicht.js', 'js/hof-ansicht.js', 'js/karte-ansicht.js', 'js/belege-ansicht.js', 'js/landkarte.js', 'landkarte.css', 'js/bestellung-ansicht.js', 'js/kacheln.js', 'js/gs1.js', 'js/scanzeilen.js', 'js/scan-daten.js', 'js/scanner.js', 'js/scan-ansicht.js', 'js/warteschlange.js', 'js/vorlesen.js', 'vendor/zxing/zxing.min.js', 'vendor/zxing/LICENSE.txt', 'test/gs1.test.mjs', 'test/scanzeilen.test.mjs', 'test/zxing.test.mjs', 'funktionen.json', 'js/nachricht-ansicht.js', 'js/tafeln.js', 'js/abgeholt-ansicht.js', 'tafeln.css', 'js/artikel-ansicht.js', 'js/telefonbuch-ansicht.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/mitteilung.js', 'js/mitteilung-ansicht.js',
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

// Mitteilung aufs Handy (A064 Stufe 2): Der Laptop schickt sie selbst (Web Push). Fester Titel, der Text steht in der Nachricht; nie etwas anderes als Text.
// Fehlt die Nachricht oder ist sie kaputt, kommt trotzdem eine (das Handy verlangt zu jeder Push-Nachricht eine sichtbare Mitteilung).
self.addEventListener('push', e => {
  let text = 'Bitte in der Hof-App nachsehen.';
  try {
    const d = e.data ? e.data.json() : null;
    if (d && typeof d.text === 'string' && d.text.trim()) text = d.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  } catch { /* der feste Satz */ }
  e.waitUntil(self.registration.showNotification('Hof-App', { body: text, tag: 'anmeldung', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { art: 'mitteilung' } }));
});

// Antippen: ist die App schon offen, kommt sie nach vorn und zeigt die Post; sonst öffnet sie sich gleich bei der Post.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const offen = fenster.find(c => new URL(c.url).origin === self.location.origin);
    if (offen) {
      try { await offen.focus(); } catch { /* dann eben nur die Nachricht */ }
      offen.postMessage({ art: 'mitteilung-geklickt' });
      return;
    }
    await self.clients.openWindow('./?post=1');
  })());
});
