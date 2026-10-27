// Lokaler Speicher im Handy (IndexedDB): Nachrichten-Verlauf, Warteschlange, Geräte-Daten.
const DB_NAME = 'hof-app';
let dbVersprechen;

function db() {
  if (!dbVersprechen) {
    dbVersprechen = new Promise((ok, fehler) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('nachrichten', { keyPath: 'id' }).createIndex('erstellt', 'erstellt');
        d.createObjectStore('einstellungen');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fehler(r.error);
    });
  }
  return dbVersprechen;
}

async function tx(store, modus, fn) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const t = d.transaction(store, modus);
    const s = t.objectStore(store);
    let ergebnis;
    Promise.resolve(fn(s)).then(r => { ergebnis = r; });
    t.oncomplete = () => ok(ergebnis);
    t.onerror = () => fehler(t.error);
    t.onabort = () => fehler(t.error);
  });
}

const anfrage = r => new Promise((ok, fehler) => { r.onsuccess = () => ok(r.result); r.onerror = () => fehler(r.error); });

export const einstellung = {
  hole: k => tx('einstellungen', 'readonly', s => anfrage(s.get(k))),
  setze: (k, v) => tx('einstellungen', 'readwrite', s => { s.put(v, k); }),
  loesche: k => tx('einstellungen', 'readwrite', s => { s.delete(k); }),
};

export const nachrichten = {
  speichere: n => tx('nachrichten', 'readwrite', s => { s.put(n); }),
  hole: id => tx('nachrichten', 'readonly', s => anfrage(s.get(id))),
  alle: () => tx('nachrichten', 'readonly', s => anfrage(s.index('erstellt').getAll())).then(l => l.reverse()),
  async aendere(id, aenderung) {
    return tx('nachrichten', 'readwrite', async s => {
      const n = await anfrage(s.get(id));
      if (n) s.put({ ...n, ...aenderung });
    });
  },
};

// Alte, abgeholte Nachrichten nach 30 Tagen aus dem Verlauf räumen.
export async function aufraeumen(tage = 30) {
  const grenze = Date.now() - tage * 864e5;
  const alle = await nachrichten.alle();
  await tx('nachrichten', 'readwrite', s => {
    for (const n of alle) if (n.status === 'abgeholt' && n.erstellt < grenze) s.delete(n.id);
  });
}
