// Oberfläche der Post: offene Rückfragen beantworten, „Für dich“ (Dokumente, Ergebnisse, Hinweise) ansehen, erledigte ansehen. Reine Darstellung – geholt, geprüft und gespeichert wird in post.js,
// gesendet wird in app.js (normale Warteschlange). Alles, was vom Laptop kommt, wird nur als Text eingesetzt (nie als HTML).
import { offene, erledigte, dinge, ergebnisText, schluesselVon } from './post.js';
import { TEST } from './modus.js';

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function istAenderungsliste(f) { return !!(f.kopf && f.kopf.frage_art === 'freigabe' && Array.isArray(f.kopf.punkte) && f.kopf.punkte.length); }

// Welche offenen Rückfragen soll dieses Handy gerade zeigen? Die Änderungsliste nur, wenn die Funktion dafür freigegeben ist.
export function sichtbareFragen(stand, modus, aenderungenAktiv) {
  return offene(stand, modus).filter(f => aenderungenAktiv || !istAenderungsliste(f));
}

const STATUS_TEXT = {
  wartet: 'Wartet auf Netz – geht von selbst raus, sobald Empfang da ist.',
  gesendet: 'Unterwegs zum Laptop …',
  abgeholt: 'Der Laptop hat sie. Die Bestätigung kommt gleich.',
};

// Welche „Für dich“-Einträge zeigt dieses Handy gerade? Nur, wenn die Funktion dafür freigegeben ist.
export function sichtbareDinge(stand, modus, dingeAktiv) {
  return dingeAktiv ? dinge(stand, modus) : [];
}

// ctx: { stand, modus, aenderungenAktiv, dingeAktiv, entwuerfe: Map, status: Map(nachricht-id -> 'wartet'|'gesendet'|'abgeholt'), zeit(isoText) -> Text,
//        beiAntwort(f, antwort) -> Promise<boolean>, beiDing(aktion: 'oeffnen' | 'erledigt', d) -> Promise, hinweis: Text, echtOffen: Zahl (nur im Test-Modus angezeigt), zuletzt: Text }
export function zeichnePost(wurzel, ctx) {
  const test = ctx.modus === TEST;
  const offen = sichtbareFragen(ctx.stand, ctx.modus, ctx.aenderungenAktiv);
  const fertig = erledigte(ctx.stand, ctx.modus).filter(f => ctx.aenderungenAktiv || !istAenderungsliste(f)).slice(0, 15);

  const hinweise = wurzel.querySelector('#post-hinweise');
  hinweise.replaceChildren();
  if (ctx.hinweis) hinweise.appendChild(el('p', 'post-hinweis', ctx.hinweis));
  if (test && ctx.echtOffen > 0) {
    hinweise.appendChild(el('p', 'post-hinweis leise', ctx.echtOffen === 1
      ? 'Echt: 1 Frage wartet. Oben auf „Echt“ stellen, um sie zu beantworten.'
      : `Echt: ${ctx.echtOffen} Fragen warten. Oben auf „Echt“ stellen, um sie zu beantworten.`));
  }
  wurzel.querySelector('#post-stand').textContent = ctx.zuletzt || '';

  const liste = wurzel.querySelector('#post-offen');
  liste.replaceChildren();
  if (!offen.length) {
    liste.appendChild(el('div', 'leer', test ? 'Keine offenen Test-Fragen.' : 'Keine offenen Fragen.'));
  }
  for (const f of offen) liste.appendChild(frageKarte(f, ctx));

  const meine = sichtbareDinge(ctx.stand, ctx.modus, ctx.dingeAktiv);
  wurzel.querySelector('#post-dinge-kopf').hidden = !meine.length;
  const dBox = wurzel.querySelector('#post-dinge');
  dBox.replaceChildren();
  for (const d of meine) dBox.appendChild(dingKarte(d, ctx));

  const box = wurzel.querySelector('#post-erledigt');
  box.replaceChildren();
  wurzel.querySelector('#post-erledigt-kopf').hidden = !fertig.length;
  for (const f of fertig) {
    const e = el('div', 'eintrag erledigt-eintrag');
    e.dataset.key = `${f.instanz}:${f.id}`;
    const kopf = el('div', 'eintrag-fuss');
    kopf.appendChild(chip(f.kopf.werkzeug_titel || f.kopf.werkzeug || 'Frage'));
    if (f.instanz === TEST) { const c = chip('Test'); c.classList.add('test'); kopf.appendChild(c); }
    e.appendChild(kopf);
    e.appendChild(el('span', 'eintrag-text', f.kopf.text));
    e.appendChild(el('span', 'ergebnis', ergebnisText(f)));
    box.appendChild(e);
  }
}

function chip(t) { return el('span', 'chip', t); }

const DING_NAME = { dokument: 'Dokument', ergebnis: 'Ergebnis', hinweis: 'Hinweis' };
function groesseText(b) {
  return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

// Ein Dokument, Ergebnis oder Hinweis „für dich“: lesen, das PDF öffnen, mit „Erledigt“ wegräumen. Alles nur als Text eingesetzt.
function dingKarte(d, ctx) {
  const k = d.kopf;
  const karte = el('article', 'ding' + (d.instanz === TEST ? ' test' : ''));
  karte.dataset.key = `${d.instanz}:${d.id}`;
  karte.dataset.ding = d.id;
  const kopf = el('div', 'eintrag-fuss');
  kopf.appendChild(chip(DING_NAME[k.ding]));
  if (k.werkzeug_titel) kopf.appendChild(chip(k.werkzeug_titel));
  if (d.instanz === TEST) { const c = chip('Test'); c.classList.add('test'); kopf.appendChild(c); }
  kopf.appendChild(el('span', 'zeit', ctx.zeit(k.erstellt || k.gesendet)));
  karte.appendChild(kopf);
  karte.appendChild(el('b', 'ding-titel', k.titel));
  if (k.text) karte.appendChild(el('p', 'ding-text', k.text));
  const zu = k.bezug ? ctx.stand.fragen[schluesselVon(d.instanz, k.bezug)] : null;           // gehört das zu einer Frage, die dieses Handy kennt?
  if (zu && zu.kopf) karte.appendChild(el('p', 'ding-zu leise klein', 'Zur Frage: ' + zu.kopf.text.split('\n')[0].slice(0, 90)));
  const zeile = el('div', 'ding-knoepfe');
  if (k.datei) {
    const auf = el('button', 'knopf haupt' + (d.instanz === TEST ? ' test' : ''), `PDF öffnen (${groesseText(k.datei.groesse)})`);
    auf.type = 'button';
    auf.dataset.aktion = 'oeffnen';
    auf.addEventListener('click', () => ctx.beiDing('oeffnen', d));
    zeile.appendChild(auf);
  } else if (k.ding === 'dokument') {
    karte.appendChild(el('p', 'ding-hinweis leise klein', k.datei_fehlt === 'zu_gross'
      ? `Das PDF ist zu groß fürs Handy (mehr als 10 MB). Es liegt am Laptop${k.datei_name ? ': ' + k.datei_name : ''}.`
      : 'Das PDF konnte nicht aufs Handy geladen werden. Es liegt am Laptop.'));
  }
  const fertig = el('button', 'knopf neben', 'Erledigt');
  fertig.type = 'button';
  fertig.dataset.aktion = 'erledigt';
  fertig.addEventListener('click', () => ctx.beiDing('erledigt', d));
  zeile.appendChild(fertig);
  karte.appendChild(zeile);
  return karte;
}

function frageKarte(f, ctx) {
  const k = f.kopf;
  const key = `${f.instanz}:${f.id}`;
  const karte = el('article', 'frage' + (f.instanz === TEST ? ' test' : ''));
  karte.dataset.key = key;
  karte.dataset.frage = f.id;
  const kopf = el('div', 'eintrag-fuss');
  kopf.appendChild(chip(k.werkzeug_titel || k.werkzeug || 'Frage'));
  if (f.instanz === TEST) { const c = chip('Test'); c.classList.add('test'); kopf.appendChild(c); }
  const z = el('span', 'zeit', ctx.zeit(k.erstellt || k.gesendet));
  kopf.appendChild(z);
  karte.appendChild(kopf);
  karte.appendChild(el('p', 'frage-text', k.text));

  const eigene = f.meine && f.meine.stand === k.stand ? f.meine : null;
  if (eigene) {                                                      // auf diese Fassung wurde schon geantwortet: warten auf die Bestätigung des Laptops
    const box = el('div', 'frage-gesendet');
    box.appendChild(el('b', null, 'Deine Antwort'));
    box.appendChild(el('span', 'frage-antwort', eigene.text));
    box.appendChild(el('span', 'leise klein', STATUS_TEXT[ctx.status.get(eigene.id)] || STATUS_TEXT.gesendet));
    karte.appendChild(box);
    return karte;
  }

  const entwurf = ctx.entwuerfe.get(key) || {};
  ctx.entwuerfe.set(key, entwurf);
  const senden = el('button', 'knopf haupt' + (f.instanz === TEST ? ' test' : ''));
  senden.type = 'button';
  senden.dataset.aktion = 'senden';
  const feld = el('div', 'antwort-bereich');

  const fertigMelden = async antwort => {
    senden.disabled = true;
    let ok = false;
    try { ok = await ctx.beiAntwort(f, antwort); } finally { if (!ok) senden.disabled = false; }
  };

  if (istAenderungsliste(f)) {
    entwurf.entscheidungen = entwurf.entscheidungen || {};
    const punkte = el('div', 'punkte');
    const knoepfe = [];
    const zusammen = el('p', 'leise klein zusammen');
    const aktualisieren = () => {
      let ja = 0, nein = 0;
      for (const p of k.punkte) { const e = entwurf.entscheidungen[p.nr]; if (e === 'ja') ja++; else if (e === 'nein') nein++; }
      const spaeter = k.punkte.length - ja - nein;
      zusammen.textContent = `${ja} Ja · ${nein} Nein · ${spaeter} Später`;
      senden.textContent = ja + nein ? 'Senden' : 'Später für alle';
      for (const [p, e, b] of knoepfe) b.setAttribute('aria-pressed', String((entwurf.entscheidungen[p.nr] || '') === e));
    };
    for (const p of k.punkte) {
      const zeile = el('div', 'punkt-zeile');
      zeile.dataset.nr = String(p.nr);
      const t = el('div', 'punkt-text');
      t.appendChild(el('b', null, `${p.nr} · ${p.titel}`));
      if (p.text) t.appendChild(el('span', 'leise klein', p.text));
      zeile.appendChild(t);
      const drei = el('div', 'dreier');
      drei.setAttribute('role', 'group');
      drei.setAttribute('aria-label', `Entscheidung zu Punkt ${p.nr}`);
      for (const [e, name] of [['ja', 'Ja'], ['nein', 'Nein'], ['spaeter', 'Später']]) {
        const b = el('button', 'dreier-wahl', name);
        b.type = 'button';
        b.dataset.e = e;
        b.addEventListener('click', () => { entwurf.entscheidungen[p.nr] = entwurf.entscheidungen[p.nr] === e ? '' : e; aktualisieren(); });
        knoepfe.push([p, e, b]);
        drei.appendChild(b);
      }
      zeile.appendChild(drei);
      punkte.appendChild(zeile);
    }
    const alleJa = el('button', 'knopf neben', 'Alle ja');
    alleJa.type = 'button';
    alleJa.dataset.aktion = 'alle-ja';
    alleJa.addEventListener('click', () => { for (const p of k.punkte) entwurf.entscheidungen[p.nr] = 'ja'; aktualisieren(); });
    senden.addEventListener('click', () => {
      const e = {};
      for (const p of k.punkte) e[p.nr] = ['ja', 'nein'].includes(entwurf.entscheidungen[p.nr]) ? entwurf.entscheidungen[p.nr] : 'spaeter';
      fertigMelden({ entscheidungen: e });
    });
    feld.append(punkte, alleJa, zusammen, senden);
    aktualisieren();
  } else if (k.antworten.length) {
    const wahl = el('div', 'antworten');
    wahl.setAttribute('role', 'group');
    const knoepfe = [];
    const aktualisieren = () => {
      for (const [i, b] of knoepfe) b.setAttribute('aria-pressed', String(entwurf.wahl === i));
      senden.disabled = !Number.isInteger(entwurf.wahl);
      senden.textContent = Number.isInteger(entwurf.wahl) ? 'Antwort senden' : 'Antwort wählen';
    };
    k.antworten.forEach((a, i) => {
      const b = el('button', 'antwort-wahl', a);
      b.type = 'button';
      b.dataset.wahl = String(i);
      b.addEventListener('click', () => { entwurf.wahl = entwurf.wahl === i ? undefined : i; aktualisieren(); });
      knoepfe.push([i, b]);
      wahl.appendChild(b);
    });
    senden.addEventListener('click', () => { if (Number.isInteger(entwurf.wahl)) fertigMelden({ wahl: entwurf.wahl }); });
    feld.append(wahl, senden);
    aktualisieren();
  } else {
    const eingabe = k.eingabe || 'text';
    const feldEl = el('input', 'antwort-text');
    feldEl.type = 'text';
    feldEl.setAttribute('aria-label', 'Deine Antwort');
    feldEl.enterKeyHint = 'send';
    feldEl.autocomplete = 'off';
    feldEl.maxLength = 1000;
    if (eingabe === 'zahl') { feldEl.inputMode = 'decimal'; feldEl.placeholder = 'Zahl, z. B. 12,5'; }
    else if (eingabe === 'ganzzahl') { feldEl.inputMode = 'numeric'; feldEl.placeholder = 'ganze Zahl, z. B. 12'; }
    else if (eingabe === 'masse') { feldEl.inputMode = 'text'; feldEl.placeholder = 'Maße, z. B. 120 x 80 cm'; }
    else feldEl.placeholder = 'Antwort eintippen';
    feldEl.value = entwurf.text || '';
    const aktualisieren = () => { senden.disabled = !feldEl.value.trim(); senden.textContent = 'Antwort senden'; };
    feldEl.addEventListener('input', () => { entwurf.text = feldEl.value; aktualisieren(); });
    feldEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (feldEl.value.trim()) senden.click(); } });
    senden.addEventListener('click', () => { const t = feldEl.value.trim(); if (t) fertigMelden({ text: t }); });
    feld.append(feldEl, senden);
    aktualisieren();
  }
  karte.appendChild(feld);
  return karte;
}
