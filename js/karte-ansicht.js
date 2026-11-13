// Die Hof-Karte am Handy (Funktion „hofkarte_bearbeiten“, Auftrag A037): dieselben Objekte wie in der Zentrale, dazu Namen ändern, Platz setzen, Neues ergänzen,
// Eigenes ausblenden – und Maschinen antippen, umbenennen, entfernen und wieder aufnehmen. Das Handy schreibt nie selbst: Jede Änderung ist ein Auftrag an den Laptop
// (k.sende → js/post.js karteAuftragBauen); der Laptop prüft, führt aus und schickt den neuen Stand zurück.
// Gezeichnet wird ausschließlich mit textContent und SVG-Attributen (nie HTML aus den Daten); die Daten hat js/post.js schon streng geprüft.
//
// k (der Zustand und die Hände der Seite, von app.js): { standort, waehle(id, modus), modus: ''|'platz'|'neu', wahl, marke, setzeMarke(x, y), setzeModus(m),
//   setzeStandort(id), laeuft, meldung: {ok, text}|null, sende(aktion, parameter) → Promise<{ok, text}>, infos(id) }

const SVG = 'http://www.w3.org/2000/svg';
export const NEU_ARTEN = [['silo', 'Silo'], ['behaelter', 'Behälter'], ['gebaeude', 'Gebäude']];
const PLATZ_TEXT = { osm: 'von OpenStreetMap', luftbild: 'aus dem Luftbild geschätzt', eigen: 'von dir gesetzt' };

function el(name, klasse, text) {
  const e = document.createElement(name);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null && text !== '') e.textContent = text;
  return e;
}
function svgEl(name, attrs) {
  const e = document.createElementNS(SVG, name);
  for (const [a, v] of Object.entries(attrs || {})) e.setAttribute(a, String(v));
  return e;
}
function knopf(text, klasse, beiKlick, aus = false) {
  const b = el('button', 'knopf ' + (klasse || ''), text);
  b.type = 'button';
  b.disabled = !!aus;
  b.addEventListener('click', beiKlick);
  return b;
}
const zahlText = x => (typeof x === 'number' ? String(Math.round(x * 10) / 10).replace('.', ',') : '');
const zahlAus = s => { const t = String(s || '').trim().replace(',', '.'); return /^-?\d{1,5}(\.\d{1,3})?$/.test(t) ? Number(t) : null; };
const datumText = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

// Die Umrandung aller Objekte (Meter) plus Rand.
export function grenzen(objekte) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const nimm = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of objekte) {
    if (o.form === 'kreis') { nimm(o.mitte[0] - o.d / 2, o.mitte[1] - o.d / 2); nimm(o.mitte[0] + o.d / 2, o.mitte[1] + o.d / 2); }
    else for (const p of o.pts) nimm(p[0], p[1]);
  }
  if (!Number.isFinite(x0)) return null;
  const rand = Math.max(6, (x1 - x0) * 0.04, (y1 - y0) * 0.04);
  return { x: x0 - rand, y: y0 - rand, b: Math.max(x1 - x0 + 2 * rand, 20), h: Math.max(y1 - y0 + 2 * rand, 20) };
}

function form(o, klasse) {
  const klassen = ['hk', o.platz === 'eigen' ? 'hk-eigen' : o.platz === 'osm' ? 'hk-osm' : 'hk-luft', o.rolle === '' || o.rolle === 'Unbekannt' ? 'hk-leise' : ''];
  const attrs = { class: klassen.filter(Boolean).join(' ') + (klasse ? ' ' + klasse : ''), 'vector-effect': 'non-scaling-stroke' };
  if (o.form === 'kreis') return svgEl('circle', { ...attrs, cx: o.mitte[0], cy: o.mitte[1], r: o.d / 2 });
  return svgEl('polygon', { ...attrs, points: o.pts.map(p => `${p[0]},${p[1]}`).join(' ') });
}

// Mess- und Tippfelder für Größe: rund = Durchmesser, sonst Breite und Tiefe.
function massFelder(wurzel, rund, vorschlag) {
  wurzel.replaceChildren();
  const feld = (id, text, wert) => {
    const l = el('label', 'karte-label', text);
    l.htmlFor = id;
    const i = el('input', 'karte-feld');
    i.id = id; i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.value = zahlText(wert);
    wurzel.append(l, i);
  };
  if (rund) feld('karte-d', 'Durchmesser in Metern', vorschlag && vorschlag.d ? vorschlag.d : 5);
  else { feld('karte-b', 'Breite in Metern (Ost-West)', vorschlag && vorschlag.b ? vorschlag.b : 20); feld('karte-t', 'Tiefe in Metern (Nord-Süd)', vorschlag && vorschlag.t ? vorschlag.t : 10); }
}
function massAusFeldern(rund) {
  const w = id => { const e = document.getElementById(id); return e ? zahlAus(e.value) : null; };
  return rund ? { durchmesser: w('karte-d') } : { breite: w('karte-b'), tiefe: w('karte-t') };
}

function meldungZeile(k) {
  if (!k.meldung || !k.meldung.text) return null;
  return el('p', 'karte-meldung ' + (k.meldung.ok ? 'ok' : 'fehler'), k.meldung.text);
}

// ---- Die Karte --------------------------------------------------------------------------------------------------------------
export function zeichneKarte(wurzel, hof, k) {
  const sid = hof.standorte.some(s => s.id === k.standort) ? k.standort : (hof.standorte[0] || {}).id;
  const st = hof.standorte.find(s => s.id === sid);
  const kopf = el('div', 'karte-kopf');
  if (hof.standorte.length > 1) {
    const leiste = el('div', 'karte-standorte');
    for (const s of hof.standorte) {
      const b = knopf(s.name, 'klein' + (s.id === sid ? ' an' : ''), () => k.setzeStandort(s.id));
      b.dataset.standort = s.id;
      leiste.append(b);
    }
    kopf.append(leiste);
  }
  wurzel.append(kopf);
  const m = meldungZeile(k);
  if (m) wurzel.append(m);
  if (!st || !st.plan) { wurzel.append(el('p', 'ue-hinweis', 'Für diesen Standort schickt der Laptop noch keine Karte. Tippe oben auf Aktualisieren.')); return; }
  const plan = st.plan;
  const g = grenzen(plan.objekte);
  const tippen = k.modus === 'platz' || k.modus === 'neu';
  if (tippen) wurzel.append(el('p', 'karte-tippen', 'Tippe auf die Karte, wo es steht. Ein roter Punkt zeigt die Stelle.'));
  if (!g) wurzel.append(el('p', 'ue-leer', 'Auf diesem Standort ist noch nichts gezeichnet.'));
  else {
    const svg = svgEl('svg', { viewBox: `${g.x} ${-(g.y + g.h)} ${g.b} ${g.h}`, class: 'karte-svg' + (tippen ? ' tippen' : ''), role: 'group', 'aria-label': `Karte ${st.name}` });
    const gruppe = svgEl('g', { transform: 'scale(1,-1)' });                       // Norden oben: y nach oben
    const reihe = plan.objekte.map(o => ({ o, f: form(o, '') }));
    reihe.sort((a, b) => (b.o.form === 'poly') - (a.o.form === 'poly'));          // Gebäude unten, Silos oben
    for (const { o, f } of reihe) {
      if (o.id === k.wahl) f.setAttribute('class', f.getAttribute('class') + ' gewaehlt');
      f.dataset.objekt = o.id;
      f.setAttribute('aria-label', o.name);
      f.addEventListener('click', ev => { if (!tippen) { ev.stopPropagation(); k.waehle(o.id, ''); } });
      gruppe.append(f);
    }
    svg.append(gruppe);
    const marke = svgEl('circle', { class: 'hk-marke', r: Math.max(g.b, g.h) / 70, cx: 0, cy: 0 });
    marke.setAttribute('visibility', k.marke ? 'visible' : 'hidden');
    if (k.marke) { marke.setAttribute('cx', k.marke.x); marke.setAttribute('cy', -k.marke.y); }
    svg.append(marke);
    const gew = plan.objekte.find(o => o.id === k.wahl);
    if (gew) {                                                                     // der Name des gewählten Objekts steht auf der Karte
      const mitte = gew.form === 'kreis' ? gew.mitte : [gew.pts.reduce((a, p) => a + p[0], 0) / gew.pts.length, gew.pts.reduce((a, p) => a + p[1], 0) / gew.pts.length];
      const t = svgEl('text', { class: 'hk-name', x: mitte[0], y: -mitte[1], 'font-size': Math.max(g.b, g.h) / 28, 'text-anchor': 'middle' });
      t.textContent = gew.name;
      svg.append(t);
    }
    svg.addEventListener('click', ev => {
      if (!tippen) return;
      ev.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = pt.matrixTransform(ctm.inverse());
      const x = Math.round(p.x * 10) / 10, y = Math.round(-p.y * 10) / 10;
      marke.setAttribute('cx', p.x); marke.setAttribute('cy', p.y); marke.setAttribute('visibility', 'visible');
      k.setzeMarke(x, y);                                                           // merkt sich die Stelle, ohne neu zu zeichnen (angefangene Eingaben bleiben)
      const hier = document.getElementById('karte-speichern');
      if (hier) hier.disabled = !!k.laeuft;
      const ort = document.getElementById('karte-ort');
      if (ort) ort.textContent = `Gewählt: ${zahlText(x)} m Ost, ${zahlText(y)} m Nord`;
    }, true);
    wurzel.append(svg);
    const legende = el('p', 'karte-legende');
    legende.append(el('span', 'hk-punkt eigen', 'von dir gesetzt'), el('span', 'hk-punkt luft', 'Luftbild'), el('span', 'hk-punkt osm', 'OpenStreetMap'));
    wurzel.append(legende);
  }
  // ---- das gewählte Objekt oder das Formular
  if (k.modus === 'neu') { wurzel.append(neuFormular(k, sid, plan)); }
  else {
    const ohne = plan.ohne_platz.find(o => o.id === k.wahl);
    const gew = plan.objekte.find(o => o.id === k.wahl);
    if (gew || ohne) wurzel.append(objektPanel(hof, k, sid, plan, gew || ohne, !gew));
    else wurzel.append(el('p', 'ue-leer', 'Tippe ein Gebäude auf der Karte an, um den Namen zu ändern.'));
  }
  if (k.modus !== 'neu') wurzel.append(knopf('Silo / Behälter / Gebäude hinzufügen', '', () => { k.setzeModus('neu'); }, k.laeuft));
  // ---- ohne Platz
  if (plan.ohne_platz.length) {
    const box = el('section', 'karte-ohne');
    box.append(el('h2', '', `Noch ohne Platz (${plan.ohne_platz.length})`));
    box.append(el('p', 'ue-hinweis', 'Antippen, dann auf der Karte tippen, wo es steht, und „Hier speichern“.'));
    const liste = el('div', 'karte-liste');
    for (const o of plan.ohne_platz) {
      const b = knopf(o.name, 'klein' + (o.id === k.wahl ? ' an' : ''), () => k.waehle(o.id, 'platz'), k.laeuft);
      b.dataset.ohne = o.id;
      liste.append(b);
    }
    box.append(liste);
    wurzel.append(box);
  }
  if (plan.ausgeblendet.length) {
    const box = el('section', 'karte-ohne');
    box.append(el('h2', '', `Ausgeblendet (${plan.ausgeblendet.length})`));
    for (const a of plan.ausgeblendet) {
      const zeile = el('div', 'karte-zeile');
      zeile.append(el('span', '', a.name), knopf('Wieder einblenden', 'klein', () => k.sende('einblenden', { objekt: a.id }), k.laeuft));
      box.append(zeile);
    }
    wurzel.append(box);
  }
}

function objektPanel(hof, k, sid, plan, o, ohnePlatz) {
  const box = el('section', 'karte-panel');
  box.append(el('h2', '', o.name));
  const kleinText = [o.rolle, ohnePlatz ? 'noch ohne Platz' : 'Platz: ' + (PLATZ_TEXT[o.platz] || '') + (o.eigen && o.seit ? ` (${datumText(o.seit)})` : '')].filter(Boolean).join(' · ');
  box.append(el('p', 'karte-klein', kleinText));
  if (k.modus === 'platz') {
    box.append(el('p', 'karte-tippen', ohnePlatz ? 'Tippe auf die Karte, wo es steht.' : 'Tippe auf die Karte, wohin es soll.'));
    const rund = ohnePlatz ? o.rund : o.form === 'kreis';
    const vorschlag = ohnePlatz ? o.vorschlag : (o.form === 'kreis' ? { d: o.d } : null);
    const mass = el('div', 'karte-mass');
    massFelder(mass, rund, vorschlag);
    box.append(mass);
    if (ohnePlatz && o.vorschlag && o.vorschlag.woher) box.append(el('p', 'karte-klein', `Maß vorgeschlagen: ${o.vorschlag.woher}. Du kannst es ändern.`));
    const ort = el('p', 'karte-klein', k.marke ? `Gewählt: ${zahlText(k.marke.x)} m Ost, ${zahlText(k.marke.y)} m Nord` : 'Noch nichts gewählt.');
    ort.id = 'karte-ort';
    box.append(ort);
    const speichern = knopf('Hier speichern', 'haupt', () => {
      if (!k.marke || k.laeuft) return;
      const p = { objekt: o.id, x: k.marke.x, y: k.marke.y, ...massAusFeldern(rund) };
      k.sende('platz', p);
    }, k.laeuft || !k.marke);
    speichern.id = 'karte-speichern';
    box.append(speichern, knopf('Abbrechen', '', () => k.setzeModus(''), k.laeuft));
    return box;
  }
  const zeile = el('div', 'karte-zeile');
  const eingabe = el('input', 'karte-feld');
  eingabe.type = 'text'; eingabe.maxLength = 60; eingabe.value = o.name; eingabe.autocomplete = 'off'; eingabe.id = 'karte-name';
  eingabe.setAttribute('aria-label', 'Neuer Name');
  zeile.append(eingabe, knopf('Name ändern', 'haupt', () => { const n = eingabe.value.trim(); if (n && n !== o.name && !k.laeuft) k.sende('name', { objekt: o.id, name: n }); }, k.laeuft));
  box.append(zeile);
  const aktionen = el('div', 'karte-zeile');
  if (ohnePlatz) aktionen.append(knopf('Platz setzen', 'haupt', () => k.setzeModus('platz'), k.laeuft));
  else if (o.eigen) {
    aktionen.append(knopf('Neu setzen', '', () => k.setzeModus('platz'), k.laeuft));
    aktionen.append(knopf('Ausblenden', '', () => k.sende('ausblenden', { objekt: o.id }), k.laeuft));
  }
  if (hof.standorte.some(s => s.gebaeude.some(g => g.id === o.id))) aktionen.append(knopf('Infos', '', () => k.infos(o.id)));
  box.append(aktionen);
  if (!ohnePlatz && !o.eigen) box.append(el('p', 'karte-klein', 'Der Umriss kommt von OpenStreetMap oder aus dem Luftbild und wird nicht verschoben. Der Name lässt sich ändern.'));
  return box;
}

function neuFormular(k, sid, plan) {
  const box = el('section', 'karte-panel karte-neu');
  box.append(el('h2', '', 'Neues hinzufügen'));
  const lArt = el('label', 'karte-label', 'Was ist es?');
  lArt.htmlFor = 'karte-art';
  const wahl = el('select', 'karte-feld');
  wahl.id = 'karte-art';
  for (const [wert, text] of NEU_ARTEN) { const o = el('option', '', text); o.value = wert; wahl.append(o); }
  const lName = el('label', 'karte-label', 'Name');
  lName.htmlFor = 'karte-neuname';
  const name = el('input', 'karte-feld');
  name.id = 'karte-neuname'; name.type = 'text'; name.maxLength = 60; name.autocomplete = 'off';
  const mass = el('div', 'karte-mass');
  const vorschlag = wahlArt => {
    const gleich = plan.objekte.filter(o => (wahlArt === 'gebaeude' ? o.form === 'poly' && o.rolle !== '' : o.form === 'kreis'));
    if (wahlArt === 'gebaeude') {
      const m = gleich.map(o => { const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]); const a = Math.max(...xs) - Math.min(...xs), b = Math.max(...ys) - Math.min(...ys); return [Math.max(a, b), Math.min(a, b)]; });
      const mitte = arr => arr.sort((x, y) => x - y)[Math.floor(arr.length / 2)];
      return m.length ? { b: Math.round(mitte(m.map(x => x[0])) * 10) / 10, t: Math.round(mitte(m.map(x => x[1])) * 10) / 10 } : { b: 20, t: 10 };
    }
    const d = gleich.map(o => o.d);
    return { d: d.length ? Math.round(d.sort((x, y) => x - y)[Math.floor(d.length / 2)] * 10) / 10 : (wahlArt === 'behaelter' ? 15 : 5) };
  };
  const mass_neu = () => massFelder(mass, wahl.value !== 'gebaeude', vorschlag(wahl.value));
  wahl.addEventListener('change', mass_neu);
  mass_neu();
  box.append(lArt, wahl, lName, name, mass);
  box.append(el('p', 'karte-klein', 'Tippe auf die Karte, wo es steht. Das Maß ist vorgeschlagen; du kannst es ändern.'));
  const ort = el('p', 'karte-klein', k.marke ? `Gewählt: ${zahlText(k.marke.x)} m Ost, ${zahlText(k.marke.y)} m Nord` : 'Noch nichts gewählt.');
  ort.id = 'karte-ort';
  box.append(ort);
  const speichern = knopf('Hier speichern', 'haupt', () => {
    if (!k.marke || k.laeuft) return;
    if (!name.value.trim()) { ort.textContent = 'Bitte einen Namen eintragen.'; return; }
    k.sende('neu', { standort: sid, art: wahl.value, name: name.value.trim(), x: k.marke.x, y: k.marke.y, ...massAusFeldern(wahl.value !== 'gebaeude') });
  }, k.laeuft || !k.marke);
  speichern.id = 'karte-speichern';
  box.append(speichern, knopf('Abbrechen', '', () => k.setzeModus(''), k.laeuft));
  return box;
}

// ---- Maschinen --------------------------------------------------------------------------------------------------------------
// Die Einzelheiten der angetippten Maschine (Zeile der Liste) mit „Umbenennen“ und „Entfernen“. „Entfernen“ fragt einmal nach.
// m = { wahl: Kennung, frage: Kennung (Nachfrage offen), laeuft, meldung, sende(aktion, parameter), waehle(id), fragen(id) }
export function zeichneMaschDetail(wurzel, z, m) {
  const box = el('section', 'karte-panel masch-detail');
  box.append(el('h2', '', z.n));
  const einzel = [z.art, z.ps, z.besitz && 'Besitz: ' + z.besitz, z.betrieb && 'Betrieb: ' + z.betrieb, z.bj && 'Baujahr ' + z.bj, z.letzter].filter(Boolean).join(' · ');
  if (einzel) box.append(el('p', 'karte-klein', einzel));
  if (m.frage === z.i) {
    box.append(el('p', 'karte-frage', `„${z.n}“ wirklich entfernen?`));
    box.append(el('p', 'karte-klein', 'Die Maschine verschwindet aus Liste und Karte. Einsätze, Preise und Wartung bleiben, nichts wird gelöscht; unter „Entfernt“ lässt sie sich wieder aufnehmen.'));
    const zeile = el('div', 'karte-zeile');
    const ja = knopf('Ja, entfernen', 'haupt', () => { if (!m.laeuft) m.sende('maschine_entfernen', { maschine: z.i, bestaetigt: true }); }, m.laeuft);
    ja.id = 'masch-ja';
    zeile.append(ja, knopf('Nein', '', () => m.fragen(''), m.laeuft));
    box.append(zeile);
    wurzel.append(box);
    return;
  }
  const zeile = el('div', 'karte-zeile');
  const eingabe = el('input', 'karte-feld');
  eingabe.type = 'text'; eingabe.maxLength = 60; eingabe.value = z.n; eingabe.autocomplete = 'off'; eingabe.id = 'masch-name';
  eingabe.setAttribute('aria-label', 'Neuer Name der Maschine');
  zeile.append(eingabe, knopf('Umbenennen', 'haupt', () => { const n = eingabe.value.trim(); if (n && n !== z.n && !m.laeuft) m.sende('maschine_umbenennen', { maschine: z.i, name: n }); }, m.laeuft));
  box.append(zeile);
  const ent = knopf('Entfernen', '', () => m.fragen(z.i), m.laeuft);
  ent.id = 'masch-entfernen';
  box.append(ent, knopf('Schließen', 'klein', () => m.waehle('')));
  wurzel.append(box);
}

// Die Liste „Entfernt“ am Ende der Maschinenliste: „Wieder aufnehmen“ holt eine Maschine zurück.
export function zeichneEntfernt(wurzel, liste, m) {
  if (!liste || !liste.entfernt || !liste.entfernt.length) return;
  const box = el('section', 'karte-ohne masch-entfernt');
  box.append(el('h2', '', `Entfernt (${liste.entfernt.length})`));
  box.append(el('p', 'karte-klein', 'Einsätze, Preise und Wartung dieser Maschinen sind erhalten.'));
  for (const e of liste.entfernt) {
    const zeile = el('div', 'karte-zeile');
    zeile.append(el('span', '', e.n), knopf('Wieder aufnehmen', 'klein', () => { if (!m.laeuft) m.sende('maschine_aufnehmen', { maschine: e.i }); }, m.laeuft));
    box.append(zeile);
  }
  wurzel.append(box);
}
