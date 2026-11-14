// Die Hof-Karte am Handy (Funktion „hofkarte_bearbeiten“, Auftrag A037): dieselben Objekte wie in der Zentrale, dazu Namen ändern, Platz setzen, Neues ergänzen,
// Eigenes ausblenden – und Maschinen antippen, umbenennen, entfernen und wieder aufnehmen. Das Handy schreibt nie selbst: Jede Änderung ist ein Auftrag an den Laptop
// (k.sende → js/post.js karteAuftragBauen); der Laptop prüft, führt aus und schickt den neuen Stand zurück.
// Gezeichnet wird ausschließlich mit textContent und SVG-Attributen (nie HTML aus den Daten); die Daten hat js/post.js schon streng geprüft.
//
// Seit A050 steht alles auf EINER Karte: alle Standorte nebeneinander (die Lage rechnet der Laptop, plan.blatt.versatz; innerhalb eines Standorts maßstäblich, Norden oben, gleicher
// Maßstab), jeder mit Überschrift und feiner Umrandung. Verschieben und Zoomen mit Finger und Maus, „Alles zeigen“ und je Standort „Hierhin springen“.
//
// k (der Zustand und die Hände der Seite, von app.js): { standort ('' = alles zeigen), fenster, setzeFenster(f), waehle(id, modus), modus: ''|'platz'|'neu', wahl, marke {x, y, standort},
//   setzeMarke(x, y, standort), setzeModus(m), setzeStandort(id), laeuft, meldung: {ok, text}|null, sende(aktion, parameter) → Promise<{ok, text}>, infos(id) }

const SVG = 'http://www.w3.org/2000/svg';
export const NEU_ARTEN = [['silo', 'Silo'], ['behaelter', 'Behälter'], ['gebaeude', 'Gebäude']];
const PLATZ_TEXT = { osm: 'von OpenStreetMap', luftbild: 'aus dem Luftbild geschätzt', skizze: 'nach Skizze geschätzt', schema: 'nur schematisch (Lage und Form nicht echt)', eigen: 'von dir gesetzt' };
export const ASPEKT = 1.25;                       // Breite : Höhe der Karte
export const ZOOM_MIN = 0.8, ZOOM_MAX = 16, NAH_AB = 2.2;       // so weit lässt sich zoomen; ab dieser Vergrößerung steht auch die Art des Gebäudes dabei

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
  const klassen = ['hk', o.platz === 'eigen' ? 'hk-eigen' : o.platz === 'osm' ? 'hk-osm' : o.platz === 'skizze' ? 'hk-skizze' : o.platz === 'schema' ? 'hk-schema' : 'hk-luft', o.rolle === '' || o.rolle === 'Unbekannt' ? 'hk-leise' : ''];
  const attrs = { class: klassen.filter(Boolean).join(' ') + (klasse ? ' ' + klasse : ''), 'vector-effect': 'non-scaling-stroke' };
  if (o.form === 'kreis') return svgEl('circle', { ...attrs, cx: o.mitte[0], cy: o.mitte[1], r: o.d / 2 });
  return svgEl('polygon', { ...attrs, points: o.pts.map(p => `${p[0]},${p[1]}`).join(' ') });
}

// Das gezeichnete Gebäude vom Laptop (wie in der Zentrale: Dach, Solarfläche, Silo). Der Laptop schickt je Objekt ein SVG-Stück; hier kommen nur
// Zeichen-Elemente ohne Verweise nach außen und ohne Ereignisse hinein. Passt etwas nicht, bleibt die schlichte Form.
const BILD_TAGS = new Set(['g', 'polygon', 'rect', 'line', 'circle', 'path', 'text', 'clipPath', 'defs', 'pattern', 'radialGradient', 'linearGradient', 'stop']);
const BILD_ATTR = /^(points|x|y|x1|y1|x2|y2|cx|cy|r|rx|width|height|d|fill|fill-opacity|stroke|stroke-opacity|stroke-width|stroke-linejoin|stroke-dasharray|transform|clip-path|id|offset|stop-color|patternUnits|font-size|font-weight|text-anchor|paint-order)$/;
function bildKnoten(text) {
  if (typeof text !== 'string' || !text || text.length > 60000) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${text}</svg>`, 'image/svg+xml'); } catch (e) { return null; }
  if (!doc || doc.getElementsByTagName('parsererror').length) return null;
  const kopie = quelle => {
    if (!BILD_TAGS.has(quelle.localName)) return null;
    const neu = document.createElementNS(SVG, quelle.localName);
    for (const a of Array.from(quelle.attributes)) {
      if (!BILD_ATTR.test(a.name)) continue;
      if (/url\(/i.test(a.value) && !/^url\(#[A-Za-z0-9_-]+\)$/.test(a.value)) continue;
      neu.setAttribute(a.name, a.value);
    }
    for (const kind of Array.from(quelle.childNodes)) {
      if (kind.nodeType === 3 && quelle.localName === 'text') neu.append(document.createTextNode(kind.nodeValue));
      else if (kind.nodeType === 1) { const k2 = kopie(kind); if (k2) neu.append(k2); }
    }
    return neu;
  };
  const g = document.createElementNS(SVG, 'g');
  for (const kind of Array.from(doc.documentElement.childNodes)) if (kind.nodeType === 1) { const k2 = kopie(kind); if (k2) g.append(k2); }
  return g.childNodes.length ? g : null;
}

// Mess- und Tippfelder für Größe: rund = Durchmesser, sonst Breite und Tiefe.
function massFelder(wurzel, rund, vorschlag, hof = null) {
  wurzel.replaceChildren();
  const feld = (id, text, wert) => {
    const l = el('label', 'karte-label', text);
    l.htmlFor = id;
    const i = el('input', 'karte-feld');
    i.id = id; i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.value = zahlText(wert);
    wurzel.append(l, i);
  };
  if (rund) feld('karte-d', 'Durchmesser in Metern', vorschlag && vorschlag.d ? vorschlag.d : 5);
  else {
    feld('karte-b', 'Breite in Metern (Ost-West)', vorschlag && vorschlag.b ? vorschlag.b : 20);
    feld('karte-t', 'Tiefe in Metern (Nord-Süd)', vorschlag && vorschlag.t ? vorschlag.t : 10);
    if (hof) richtungFelder(wurzel, hof);
  }
}
function massAusFeldern(rund) {
  const w = id => { const e = document.getElementById(id); return e ? zahlAus(e.value) : null; };
  if (rund) return { durchmesser: w('karte-d') };
  const aus = { breite: w('karte-b'), tiefe: w('karte-t') };
  const r = document.getElementById('karte-richtung'), wi = document.getElementById('karte-winkel');
  if (r && r.value) aus.richtung = r.value;                                          // „an Gebäude anlegen“ (A050): übernimmt dessen Richtung
  else if (wi && wi.value.trim() !== '') { const grad = zahlAus(wi.value); if (grad !== null && Math.abs(grad) <= 360) aus.winkel = grad; }
  return aus;
}

// Ausrichtung eines Gebäudes (A050): nicht gedreht, an ein Gebäude anlegen (gleiche Richtung) oder ein Winkel in Grad.
function richtungFelder(wurzel, hof) {
  const l = el('label', 'karte-label', 'Ausrichtung (Gebäude)');
  l.htmlFor = 'karte-richtung';
  const wahl = el('select', 'karte-feld');
  wahl.id = 'karte-richtung';
  const o0 = el('option', '', 'Norden oben (nicht gedreht)');
  o0.value = '';
  wahl.append(o0);
  for (const o of alleObjekte(hof)) {
    if (o.form !== 'poly' || !o.rolle || o.rolle === 'Unbekannt' || o.rolle === 'Gebäude') continue;
    const x = el('option', '', `an „${o.name}“ anlegen (gleiche Richtung)`);
    x.value = o.id;
    wahl.append(x);
  }
  const l2 = el('label', 'karte-label', 'oder Winkel in Grad (0 = nicht gedreht)');
  l2.htmlFor = 'karte-winkel';
  const w = el('input', 'karte-feld');
  w.id = 'karte-winkel'; w.type = 'text'; w.inputMode = 'decimal'; w.autocomplete = 'off';
  wurzel.append(l, wahl, l2, w);
}

function meldungZeile(k) {
  if (!k.meldung || !k.meldung.text) return null;
  return el('p', 'karte-meldung ' + (k.meldung.ok ? 'ok' : 'fehler'), k.meldung.text);
}

// ---- Das gemeinsame Blatt ------------------------------------------------------------------------------------------------------
// Alle Standorte mit Plan und Lage (plan.blatt) auf einem Blatt in Metern (Norden oben). Ein Standort ohne Lage fehlt auf dem Blatt (nichts wird geraten).
export function blattBauen(hof) {
  const teile = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of hof.standorte) {
    if (!s.plan || !s.plan.blatt || !s.plan.objekte.length) continue;
    const [dx, dy] = s.plan.blatt.versatz, r = s.plan.blatt.rahmen;
    teile.push({ s, dx, dy, rahmen: r });
    x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]);
  }
  return teile.length ? { teile, x0, y0, x1, y1 } : null;
}
// Ein Ansichtsfenster {cx, cy, w}: Mitte und Breite in Metern (die Höhe folgt aus ASPEKT).
export function fensterFuer(rahmen, rand = 1.06) {
  const [a, b, c, d] = rahmen;
  return { cx: (a + c) / 2, cy: (b + d) / 2, w: Math.max((c - a) * rand, (d - b) * rand * ASPEKT, 10) };
}
export const fensterAlles = bl => fensterFuer([bl.x0, bl.y0, bl.x1, bl.y1], 1.04);
const viewBoxText = f => `${f.cx - f.w / 2} ${-f.cy - f.w / ASPEKT / 2} ${f.w} ${f.w / ASPEKT}`;

function findeObjekt(hof, id) {
  for (const s of hof.standorte) {
    if (!s.plan) continue;
    const o = s.plan.objekte.find(x => x.id === id);
    if (o) return { s, plan: s.plan, o, ohne: false };
    const ohne = s.plan.ohne_platz.find(x => x.id === id);
    if (ohne) return { s, plan: s.plan, o: ohne, ohne: true };
  }
  return null;
}
function alleObjekte(hof) { return hof.standorte.flatMap(s => (s.plan ? s.plan.objekte : [])); }

// ---- Die Karte --------------------------------------------------------------------------------------------------------------
export function zeichneKarte(wurzel, hof, k) {
  const bl = blattBauen(hof);
  const kopf = el('div', 'karte-kopf');
  if (bl) {
    const leiste = el('div', 'karte-standorte');
    const alles = knopf('Alles zeigen', 'klein', () => {}, false);
    alles.dataset.alles = '1';
    leiste.append(alles);
    for (const t of bl.teile) {
      const b = knopf(t.s.name, 'klein', () => {}, false);
      b.dataset.standort = t.s.id;
      b.title = 'Hierhin springen';
      b.append(el('span', 'karte-sprung', 'Hierhin springen'));
      leiste.append(b);
    }
    kopf.append(leiste);
  }
  wurzel.append(kopf);
  const m = meldungZeile(k);
  if (m) wurzel.append(m);
  const tippen = k.modus === 'platz' || k.modus === 'neu';
  if (!bl) { wurzel.append(el('p', 'ue-hinweis', 'Der Laptop schickt noch keine Karte. Tippe oben auf Aktualisieren.')); }
  else {
    if (tippen) wurzel.append(el('p', 'karte-tippen', 'Tippe auf die Karte, in die Umrandung des Standorts, wo es steht. Ein roter Punkt zeigt die Stelle.'));
    const svg = svgEl('svg', { class: 'karte-svg' + (tippen ? ' tippen' : ''), role: 'group', 'aria-label': 'Karte aller Standorte' });
    svg.dataset.aspekt = String(ASPEKT);
    const flaechen = svgEl('g', {});
    const gruppe = svgEl('g', { transform: 'scale(1,-1)' });                       // Norden oben: y nach oben
    const schilder = svgEl('g', { class: 'hk-schilder' });
    const ueberschriften = [];
    const namen = [];                                                              // {text, x, y, kreis} – die Beschriftung bleibt beim Zoomen gleich groß (karteAnpassen)
    const gew = k.wahl;
    for (const t of bl.teile) {
      const r = t.rahmen;
      const rahmen = svgEl('rect', { class: 'hk-rahmen', x: r[0], y: -r[3], width: r[2] - r[0], height: r[3] - r[1], rx: 3, 'vector-effect': 'non-scaling-stroke' });
      rahmen.dataset.standort = t.s.id;
      flaechen.append(rahmen);
      const u = svgEl('text', { class: 'hk-kopf', x: r[0] + 2, y: -r[3] + 1 });
      u.textContent = t.s.name + (t.s.plan.objekte.some(o => o.platz === 'schema') ? ' (schematisch)' : '');
      u.dataset.standort = t.s.id;
      ueberschriften.push(u);
    }
    const reihe = [];
    const bildS = hof.bild && Number(hof.bild.s) > 0 ? Number(hof.bild.s) : 0;
    let mitBild = 0;
    if (bildS) { const d = bildKnoten(hof.bild.defs); if (d) svg.append(d); }
    for (const t of bl.teile) {
      for (const o of t.s.plan.objekte) {
        const v = o.form === 'kreis' ? { ...o, mitte: [o.mitte[0] + t.dx, o.mitte[1] + t.dy] } : { ...o, pts: o.pts.map(p => [p[0] + t.dx, p[1] + t.dy]) };
        const b = bildS ? bildKnoten(o.bild) : null;
        if (b) { b.setAttribute('transform', `translate(${t.dx} ${t.dy}) scale(${1 / bildS} ${-1 / bildS})`); b.setAttribute('class', 'hk-bild'); mitBild += 1; }
        reihe.push({ o: v, f: form(v, b ? 'hk-mitbild' : ''), b });
      }
    }
    reihe.sort((a, b) => (b.o.form === 'poly') - (a.o.form === 'poly'));          // Gebäude unten, Silos oben
    for (const { b } of reihe) if (b) gruppe.append(b);                            // erst die Bilder, darüber die (durchsichtigen) Formen zum Antippen
    svg.dataset.bilder = String(mitBild);
    for (const { o, f } of reihe) {
      if (o.id === gew) f.setAttribute('class', f.getAttribute('class') + ' gewaehlt');
      f.dataset.objekt = o.id;
      f.setAttribute('aria-label', o.name);
      f.addEventListener('click', ev => { if (!tippen && !svg._gezogen()) { ev.stopPropagation(); k.waehle(o.id, ''); } });
      gruppe.append(f);
      if (o.rolle) {
        const mitte = o.form === 'kreis' ? o.mitte : [o.pts.reduce((a, p) => a + p[0], 0) / o.pts.length, o.pts.reduce((a, p) => a + p[1], 0) / o.pts.length];
        namen.push({ o, x: mitte[0], y: mitte[1], kreis: o.form === 'kreis' });
      }
    }
    svg.append(flaechen, gruppe);
    for (const n of namen) {
      const t = svgEl('text', { class: 'hk-name' + (n.o.id === gew ? ' gewaehlt-name' : ''), x: n.x, y: -n.y, 'text-anchor': 'middle' });
      t.textContent = n.o.name;
      t.dataset.kreis = n.kreis ? '1' : '';
      t.dataset.rolle = n.o.rolle;
      schilder.append(t);
    }
    for (const u of ueberschriften) schilder.append(u);
    svg.append(schilder);
    const marke = svgEl('circle', { class: 'hk-marke', r: 3, cx: 0, cy: 0 });
    marke.setAttribute('visibility', k.marke ? 'visible' : 'hidden');
    const fest = k.marke ? bl.teile.find(t => t.s.id === k.marke.standort) : null;
    if (k.marke && fest) { marke.setAttribute('cx', k.marke.x + fest.dx); marke.setAttribute('cy', -(k.marke.y + fest.dy)); }
    else marke.setAttribute('visibility', 'hidden');
    svg.append(marke);
    wurzel.append(svg);
    karteBedienen(svg, bl, k, tippen, marke, { schilder, namen, ueberschriften, kopf });
    const legende = el('p', 'karte-legende');
    if (mitBild) legende.append(el('span', 'hk-punkt eigen', 'von dir gesetzt'), el('span', 'hk-punkt skizze', 'gestrichelt: nach Skizze oder schematisch'));
    else legende.append(el('span', 'hk-punkt eigen', 'von dir gesetzt'), el('span', 'hk-punkt luft', 'Luftbild'), el('span', 'hk-punkt osm', 'OpenStreetMap'),
                        el('span', 'hk-punkt skizze', 'nach Skizze'));
    wurzel.append(legende);
  }
  // ---- das gewählte Objekt oder das Formular
  if (k.modus === 'neu') { wurzel.append(neuFormular(k, bl ? bl.teile[0].s.id : '', hof)); }
  else {
    const t = k.wahl ? findeObjekt(hof, k.wahl) : null;
    if (t) wurzel.append(objektPanel(hof, k, t.s.id, t.plan, t.o, t.ohne));
    else wurzel.append(el('p', 'ue-leer', 'Tippe ein Gebäude auf der Karte an, um den Namen zu ändern.'));
  }
  if (k.modus !== 'neu') wurzel.append(knopf('Silo / Behälter / Gebäude hinzufügen', '', () => { k.setzeModus('neu'); }, k.laeuft));
  // ---- ohne Platz, nach Standort gruppiert
  const mitOhne = hof.standorte.filter(s => s.plan && s.plan.ohne_platz.length);
  const anzahlOhne = mitOhne.reduce((a, s) => a + s.plan.ohne_platz.length, 0);
  if (anzahlOhne) {
    const box = el('section', 'karte-ohne');
    box.append(el('h2', '', `Noch ohne Platz (${anzahlOhne})`));
    box.append(el('p', 'ue-hinweis', 'Antippen, dann auf der Karte in die Umrandung des Standorts tippen, wo es steht, und „Hier speichern“.'));
    for (const s of mitOhne) {
      const gruppeBox = el('div', 'karte-gruppe');
      gruppeBox.dataset.standort = s.id;
      gruppeBox.append(el('h3', 'karte-gruppe-name', `${s.name} (${s.plan.ohne_platz.length})`));
      const liste = el('div', 'karte-liste');
      for (const o of s.plan.ohne_platz) {
        const b = knopf(o.name, 'klein' + (o.id === k.wahl ? ' an' : ''), () => k.waehle(o.id, 'platz'), k.laeuft);
        b.dataset.ohne = o.id;
        liste.append(b);
      }
      gruppeBox.append(liste);
      box.append(gruppeBox);
    }
    wurzel.append(box);
  }
  const weg = hof.standorte.flatMap(s => (s.plan ? s.plan.ausgeblendet : []));
  if (weg.length) {
    const box = el('section', 'karte-ohne');
    box.append(el('h2', '', `Ausgeblendet (${weg.length})`));
    for (const a of weg) {
      const zeile = el('div', 'karte-zeile');
      zeile.append(el('span', '', a.name), knopf('Wieder einblenden', 'klein', () => k.sende('einblenden', { objekt: a.id }), k.laeuft));
      box.append(zeile);
    }
    wurzel.append(box);
  }
}

// Verschieben (ziehen), Zoomen (Mausrad, zwei Finger, Knöpfe), Springen; die Schrift bleibt beim Zoomen gleich groß. Der Zustand des Fensters wird gemerkt (k.setzeFenster),
// damit er beim Neuzeichnen (anderes Gebäude gewählt) bleibt. Die Seite selbst wird nicht quer geschoben: Die Karte fängt das Ziehen ab (touch-action: none).
function karteBedienen(svg, bl, k, tippen, marke, teile) {
  let f = k.fenster || (k.standort && bl.teile.find(t => t.s.id === k.standort) ? fensterFuer(bl.teile.find(t => t.s.id === k.standort).rahmen) : fensterAlles(bl));
  const ganz = fensterAlles(bl);
  const zeiger = new Map();
  let gezogen = 0, vorher = null;
  svg._gezogen = () => Date.now() - gezogen < 300;
  const breitePx = () => svg.getBoundingClientRect().width || 320;
  const anpassen = () => {
    const z = ganz.w / f.w;                                                         // Vergrößerung gegenüber „Alles zeigen“
    const pro = f.w / breitePx();                                                   // Meter je Bildschirmpunkt
    svg.setAttribute('viewBox', viewBoxText(f));
    svg.dataset.zoom = z.toFixed(2);
    svg.dataset.stufe = z >= NAH_AB ? 'nah' : 'ganz';
    for (const t of teile.schilder.querySelectorAll('.hk-name')) {
      const nah = z >= NAH_AB;
      t.setAttribute('font-size', (12.5 * pro).toFixed(3));
      t.setAttribute('stroke-width', (3 * pro).toFixed(3));
      t.setAttribute('display', t.dataset.kreis === '1' && !nah ? 'none' : '');     // in der Gesamtansicht nur die Gebäude, die Silos erst vergrößert
    }
    for (const u of teile.ueberschriften) {
      u.setAttribute('font-size', (14.5 * pro).toFixed(3));
      u.setAttribute('stroke-width', (3.5 * pro).toFixed(3));
      u.setAttribute('dy', (14.5 * pro * 0.95).toFixed(3));
    }
    marke.setAttribute('r', (7 * pro).toFixed(3));
    for (const b of teile.kopf.querySelectorAll('button')) {
      const w = b.dataset.alles ? ganz : fensterFuer(bl.teile.find(t => t.s.id === b.dataset.standort).rahmen);
      const an = Math.abs(w.cx - f.cx) < w.w * 0.02 && Math.abs(w.cy - f.cy) < w.w * 0.02 && Math.abs(w.w - f.w) < w.w * 0.02;
      b.classList.toggle('an', an);
    }
    if (typeof k.setzeFenster === 'function') k.setzeFenster(f);
  };
  const setze = g => {
    const w = Math.max(ganz.w / ZOOM_MAX, Math.min(ganz.w / ZOOM_MIN, g.w));
    const h = w / ASPEKT;
    f = { w, cx: Math.max(bl.x0 - w * 0.4, Math.min(bl.x1 + w * 0.4, g.cx)), cy: Math.max(bl.y0 - h * 0.4, Math.min(bl.y1 + h * 0.4, g.cy)) };
    anpassen();
  };
  const fahre = ziel => {
    const start = { ...f };
    if (typeof requestAnimationFrame !== 'function') { setze(ziel); return; }
    let t0 = null;
    const schritt = jetzt => {
      if (t0 === null) t0 = jetzt;
      const q = Math.min(1, (jetzt - t0) / 260), e = q < 0.5 ? 2 * q * q : 1 - ((-2 * q + 2) ** 2) / 2;
      setze({ cx: start.cx + (ziel.cx - start.cx) * e, cy: start.cy + (ziel.cy - start.cy) * e, w: start.w + (ziel.w - start.w) * e });
      if (q < 1) requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  };
  const kartenPunkt = (cx, cy) => {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: f.cx, y: f.cy };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };                                                    // Meter auf dem Blatt (Norden oben)
  };
  const zoomUm = (faktor, px, py) => {
    const w = Math.max(ganz.w / ZOOM_MAX, Math.min(ganz.w / ZOOM_MIN, f.w / faktor));
    const q = w / f.w;
    setze({ w, cx: px - (px - f.cx) * q, cy: py - (py - f.cy) * q });
  };
  anpassen();
  for (const b of teile.kopf.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const ziel = b.dataset.alles ? ganz : fensterFuer(bl.teile.find(t => t.s.id === b.dataset.standort).rahmen);
      fahre(ziel);
    });
  }
  svg.addEventListener('wheel', ev => { ev.preventDefault(); const p = kartenPunkt(ev.clientX, ev.clientY); zoomUm(Math.exp(-ev.deltaY * 0.0016), p.x, p.y); }, { passive: false });
  svg.addEventListener('pointerdown', ev => { zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, zieht: false }); vorher = null; });
  svg.addEventListener('pointermove', ev => {
    const z = zeiger.get(ev.pointerId);
    if (!z) return;
    const pro = f.w / breitePx();
    if (zeiger.size >= 2) {                                                         // zwei Finger: vergrößern und verschieben
      z.x = ev.clientX; z.y = ev.clientY;
      const [a, b] = [...zeiger.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (vorher && vorher.d > 0 && d > 0) {
        const pm = kartenPunkt(mx, my);
        zoomUm(d / vorher.d, pm.x, pm.y);
        setze({ w: f.w, cx: f.cx - (mx - vorher.x) * (f.w / breitePx()), cy: f.cy + (my - vorher.y) * (f.w / breitePx()) });
      }
      vorher = { d, x: mx, y: my };
      gezogen = Date.now();
      return;
    }
    if (!z.zieht && Math.hypot(ev.clientX - z.x0, ev.clientY - z.y0) < 6) return;
    if (!z.zieht) { z.zieht = true; try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ } }
    setze({ w: f.w, cx: f.cx - (ev.clientX - z.x) * pro, cy: f.cy + (ev.clientY - z.y) * pro });
    z.x = ev.clientX; z.y = ev.clientY;
    gezogen = Date.now();
  });
  const ende = ev => { zeiger.delete(ev.pointerId); vorher = null; };
  svg.addEventListener('pointerup', ende);
  svg.addEventListener('pointercancel', ende);
  svg.addEventListener('click', ev => {
    if (svg._gezogen()) { ev.preventDefault(); ev.stopPropagation(); return; }
    if (!tippen) return;
    ev.preventDefault();
    const p = kartenPunkt(ev.clientX, ev.clientY);
    const treffer = bl.teile.filter(t => p.x >= t.rahmen[0] && p.x <= t.rahmen[2] && p.y >= t.rahmen[1] && p.y <= t.rahmen[3])
      .sort((a, b) => (a.rahmen[2] - a.rahmen[0]) * (a.rahmen[3] - a.rahmen[1]) - (b.rahmen[2] - b.rahmen[0]) * (b.rahmen[3] - b.rahmen[1]))[0];
    const ort = document.getElementById('karte-ort');
    if (!treffer) { if (ort) ort.textContent = 'Dort gehört die Karte zu keinem Standort. Bitte in eine Umrandung tippen.'; return; }
    const x = Math.round((p.x - treffer.dx) * 10) / 10, y = Math.round((p.y - treffer.dy) * 10) / 10;
    marke.setAttribute('cx', p.x); marke.setAttribute('cy', -p.y); marke.setAttribute('visibility', 'visible');
    k.setzeMarke(x, y, treffer.s.id);                                               // merkt sich die Stelle, ohne neu zu zeichnen (angefangene Eingaben bleiben)
    const hier = document.getElementById('karte-speichern');
    if (hier) hier.disabled = !!k.laeuft;
    if (ort) ort.textContent = `Gewählt: ${zahlText(x)} m Ost, ${zahlText(y)} m Nord (${treffer.s.name})`;
  }, true);
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
    massFelder(mass, rund, vorschlag, hof);
    box.append(mass);
    if (ohnePlatz && o.vorschlag && o.vorschlag.woher) box.append(el('p', 'karte-klein', `Maß vorgeschlagen: ${o.vorschlag.woher}. Du kannst es ändern.`));
    const ort = el('p', 'karte-klein', k.marke ? `Gewählt: ${zahlText(k.marke.x)} m Ost, ${zahlText(k.marke.y)} m Nord` : 'Noch nichts gewählt.');
    ort.id = 'karte-ort';
    box.append(ort);
    const speichern = knopf('Hier speichern', 'haupt', () => {
      if (!k.marke || k.laeuft) return;
      const p = { objekt: o.id, x: k.marke.x, y: k.marke.y, ...(k.marke.standort ? { standort: k.marke.standort } : {}), ...massAusFeldern(rund) };
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

function neuFormular(k, sid, hof) {
  const plan = { objekte: alleObjekte(hof) };
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
  const mass_neu = () => massFelder(mass, wahl.value !== 'gebaeude', vorschlag(wahl.value), hof);
  wahl.addEventListener('change', mass_neu);
  mass_neu();
  box.append(lArt, wahl, lName, name, mass);
  box.append(el('p', 'karte-klein', 'Tippe auf die Karte, in die Umrandung des Standorts, wo es steht (daraus ergibt sich der Standort). Das Maß ist vorgeschlagen; du kannst es ändern.'));
  const ort = el('p', 'karte-klein', k.marke ? `Gewählt: ${zahlText(k.marke.x)} m Ost, ${zahlText(k.marke.y)} m Nord` : 'Noch nichts gewählt.');
  ort.id = 'karte-ort';
  box.append(ort);
  const speichern = knopf('Hier speichern', 'haupt', () => {
    if (!k.marke || k.laeuft) return;
    if (!name.value.trim()) { ort.textContent = 'Bitte einen Namen eintragen.'; return; }
    k.sende('neu', { standort: k.marke.standort || sid, art: wahl.value, name: name.value.trim(), x: k.marke.x, y: k.marke.y, ...massAusFeldern(wahl.value !== 'gebaeude') });
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
