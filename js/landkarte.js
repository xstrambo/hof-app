/* Die Karte (A054): verschieben und heranholen wie eine Landkarte. Felder und Gebäude als farbige Flächen, Antippen zeigt eine Blase mit „Öffnen“.
   Eine Datei für die Zentrale und die Hof-App (dort liegt eine gleiche Kopie). Keine fremden Bausteine. Nur lesen: Die Karte ändert nichts. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const KACHEL = 256, Z_MIN = 9, Z_MAX = 19.4;
  const lonX = lon => (lon + 180) / 360;
  const latY = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const el = (name, attrs, eltern) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (eltern) eltern.appendChild(e); return e; };
  const html = (name, klasse, eltern, text) => { const e = document.createElement(name); if (klasse) e.className = klasse; if (text != null) e.textContent = text; if (eltern) eltern.appendChild(e); return e; };
  const farbeOk = f => typeof f === 'string' && /^#[0-9a-fA-F]{6}$/.test(f);

  // Prüft die Daten: nur was vollständig und plausibel ist, wird gezeichnet (nichts wird geraten).
  function pruefen(liste) {
    const aus = [];
    for (const o of Array.isArray(liste) ? liste : []) {
      if (!o || typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.ringe) || !o.ringe.length) continue;
      const ringe = [];
      let gut = true;
      for (const r of o.ringe) {
        if (!Array.isArray(r) || r.length < 3) { gut = false; break; }
        const w = [];
        for (const p of r) {
          if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85) { gut = false; break; }
          w.push([lonX(p[0]), latY(p[1])]);
        }
        if (!gut) break;
        ringe.push(w);
      }
      if (!gut) continue;
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0, sx = 0, sy = 0;
      for (const p of ringe[0]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); sx += p[0]; sy += p[1]; }
      aus.push({ id: o.id, name: o.name, unter: typeof o.unter === 'string' ? o.unter : '', ziel: typeof o.ziel === 'string' && o.ziel.startsWith('/') ? o.ziel : '',
                 farbe: farbeOk(o.farbe) ? o.farbe : '#9aa3a0', ringe, box: [x0, y0, x1, y1], mitte: [sx / ringe[0].length, sy / ringe[0].length] });
    }
    return aus;
  }

  function start(ziel, daten, opt) {
    opt = opt || {};
    const felder = pruefen(daten.felder).map(o => Object.assign(o, { art: 'feld' }));
    const gebaeude = pruefen(daten.gebaeude).map(o => Object.assign(o, { art: 'geb' }));
    const alle = felder.concat(gebaeude);
    ziel.textContent = '';
    ziel.classList.add('lk-bereit');
    const kacheln = html('div', 'lk-kacheln', ziel);
    const svg = el('svg', { class: 'lk-svg', role: 'img', 'aria-label': 'Felder und Gebäude' }, ziel);
    const gFlaechen = el('g', {}, svg), gSchilder = el('g', {}, svg);
    const knoepfe = html('div', 'lk-knoepfe', ziel);
    const plus = html('button', '', knoepfe, '+'), minus = html('button', '', knoepfe, '−');
    plus.type = minus.type = 'button'; plus.setAttribute('aria-label', 'Näher heran'); minus.setAttribute('aria-label', 'Weiter weg');
    const quelle = html('div', 'lk-quelle', ziel, daten.luftbild && typeof daten.quelle === 'string' ? daten.quelle : '');
    const blase = html('div', 'lk-blase', ziel); blase.hidden = true;
    if (!alle.length) html('p', 'lk-leer', ziel, 'Noch nichts auf der Karte: Es sind keine Felder mit Feldgrenze und keine Gebäude mit Platz gespeichert.');

    const an = { x: 0.5, y: 0.33, z: 13 };
    let wahl = null, bildNr = 0;
    const groesse = () => { const r = ziel.getBoundingClientRect(); return [Math.max(1, r.width), Math.max(1, r.height)]; };
    const massstab = () => KACHEL * Math.pow(2, an.z);
    const px = (p, w, h, m) => [(p[0] - an.x) * m + w / 2, (p[1] - an.y) * m + h / 2];

    for (const o of alle) {
      o.pfad = el('path', { class: 'lk-' + o.art, 'fill-rule': 'evenodd', tabindex: '0', role: 'button', 'aria-label': o.name + (o.unter ? ', ' + o.unter : '') }, gFlaechen);
      o.pfad.style.fill = o.farbe; o.pfad.style.stroke = o.farbe;
      o.schild = el('text', { class: 'lk-schild lk-schild-' + o.art }, gSchilder); o.schild.textContent = o.name;
      const auf = ev => { ev.stopPropagation(); waehle(o); };
      o.pfad.addEventListener('click', auf);
      o.pfad.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); auf(ev); } });
    }

    function kachelnZeichnen(w, h, m) {
      if (!daten.luftbild) { kacheln.textContent = ''; return; }
      const Z = Math.max(3, Math.min(19, Math.round(an.z))), n = Math.pow(2, Z), s = m / (KACHEL * n) * KACHEL;      // s: Kantenlänge einer Kachel in Pixeln
      const x0 = Math.floor(an.x * n - w / 2 / s), x1 = Math.floor(an.x * n + w / 2 / s), y0 = Math.floor(an.y * n - h / 2 / s), y1 = Math.floor(an.y * n + h / 2 / s);
      const gebraucht = new Set();
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 80) {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const key = Z + '/' + x + '/' + y; gebraucht.add(key);
          let b = kacheln.querySelector('img[data-k="' + key + '"]');
          if (!b) {
            b = html('img', '', kacheln); b.dataset.k = key; b.alt = ''; b.draggable = false; b.decoding = 'async';
            b.addEventListener('error', () => { b.classList.add('lk-fehlt'); });
            b.src = (opt.kachel || ((z, kx, ky) => '/karte/kachel/' + z + '/' + kx + '/' + ky))(Z, x, y);
          }
          b.style.width = b.style.height = Math.ceil(s) + 'px';
          b.style.transform = 'translate(' + Math.round((x / n - an.x) * m + w / 2) + 'px,' + Math.round((y / n - an.y) * m + h / 2) + 'px)';
        }
      }
      for (const b of Array.from(kacheln.children)) if (!gebraucht.has(b.dataset.k)) b.remove();
    }

    function zeichnen() {
      bildNr = 0;
      const [w, h] = groesse(), m = massstab();
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      kachelnZeichnen(w, h, m);
      const belegt = [];
      const frei = (a, b, c, d) => { if (belegt.some(q => a < q[2] && c > q[0] && b < q[3] && d > q[1])) return false; belegt.push([a, b, c, d]); return true; };
      let sichtbar = 0;
      const folge = alle.slice().sort((a, b) => (b === wahl) - (a === wahl) || (a.art === 'geb') - (b.art === 'geb') || (b.box[2] - b.box[0]) - (a.box[2] - a.box[0]));
      for (const o of alle) {
        const a = px([o.box[0], o.box[1]], w, h, m), b = px([o.box[2], o.box[3]], w, h, m);
        o.drin = b[0] > -20 && a[0] < w + 20 && b[1] > -20 && a[1] < h + 20;
        if (!o.drin) { o.pfad.setAttribute('d', ''); continue; }
        sichtbar++;
        o.pfad.setAttribute('d', o.ringe.map(r => 'M' + r.map(p => { const q = px(p, w, h, m); return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L') + 'Z').join(''));
        o.breitePx = b[0] - a[0];
      }
      for (const o of folge) {
        let zeigen = o.drin && (o.art === 'feld' ? an.z >= 12.6 : an.z >= 16.6);
        if (zeigen) {
          const fs = o.art === 'feld' ? 13 : 12, halb = (o.name.length * 0.56 * fs + 6) / 2, q = px(o.mitte, w, h, m);
          zeigen = (o === wahl || halb * 2 <= o.breitePx + 30) && frei(q[0] - halb, q[1] - fs, q[0] + halb, q[1] + fs * 0.4);
          if (zeigen) { o.schild.setAttribute('x', q[0].toFixed(1)); o.schild.setAttribute('y', (q[1] + fs * 0.35).toFixed(1)); }
        }
        o.schild.setAttribute('display', zeigen ? '' : 'none');
      }
      ziel.dataset.zoom = an.z.toFixed(2); ziel.dataset.sichtbar = String(sichtbar);
      blaseSetzen();
    }
    const plane = () => { if (!bildNr) bildNr = requestAnimationFrame(zeichnen); };

    function zoom(faktor, sx, sy) {
      const [w, h] = groesse(); if (sx == null) { sx = w / 2; sy = h / 2; }
      const m0 = massstab(), wx = an.x + (sx - w / 2) / m0, wy = an.y + (sy - h / 2) / m0;
      an.z = Math.max(Z_MIN, Math.min(Z_MAX, an.z + Math.log2(faktor)));
      const m1 = massstab(); an.x = wx - (sx - w / 2) / m1; an.y = wy - (sy - h / 2) / m1; plane();
    }
    function zeige(box, rand) {
      const [w, h] = groesse(), bw = Math.max(box[2] - box[0], 1e-7), bh = Math.max(box[3] - box[1], 1e-7);
      an.x = (box[0] + box[2]) / 2; an.y = (box[1] + box[3]) / 2;
      an.z = Math.max(Z_MIN, Math.min(18.5, Math.log2(Math.min(w / bw, h / bh) / KACHEL / (rand || 1.15)))); plane();
    }
    const boxVon = liste => liste.reduce((b, o) => [Math.min(b[0], o.box[0]), Math.min(b[1], o.box[1]), Math.max(b[2], o.box[2]), Math.max(b[3], o.box[3])], [1, 1, 0, 0]);

    // Auswahl
    function waehle(o) {
      abwahl(); wahl = o; o.pfad.classList.add('lk-wahl');
      blase.textContent = '';
      html('b', '', blase, o.name);
      if (o.unter) html('span', '', blase, o.unter);
      const zeile = html('div', 'lk-blase-zeile', blase);
      if (typeof opt.oeffnen === 'function') { const k = html('button', 'lk-oeffnen', zeile, 'Öffnen'); k.type = 'button'; k.addEventListener('click', ev => { ev.stopPropagation(); opt.oeffnen({ id: o.id, art: o.art }); }); }
      else if (o.ziel) { const a = html('a', 'lk-oeffnen', zeile, 'Öffnen'); a.href = o.ziel; }
      const zu = html('button', 'lk-zu', zeile, 'Schließen'); zu.type = 'button'; zu.addEventListener('click', ev => { ev.stopPropagation(); abwahl(); plane(); });
      blase.hidden = false; plane();
    }
    function abwahl() { if (wahl) wahl.pfad.classList.remove('lk-wahl'); wahl = null; blase.hidden = true; }
    function blaseSetzen() {
      if (!wahl) return;
      const [w, h] = groesse(), q = px(wahl.mitte, w, h, massstab());
      blase.style.left = Math.max(8, Math.min(w - 236, q[0] + 10)) + 'px'; blase.style.top = Math.max(8, Math.min(h - 120, q[1] + 10)) + 'px';
    }

    // Bedienung: ziehen, Mausrad, zwei Finger, Tasten
    const finger = new Map(); let bewegt = false, abstand = 0;
    ziel.addEventListener('pointerdown', ev => { if (ev.target.closest('.lk-knoepfe,.lk-blase')) return; finger.set(ev.pointerId, [ev.clientX, ev.clientY]); bewegt = false; });
    ziel.addEventListener('pointermove', ev => {
      if (!finger.has(ev.pointerId)) return;
      const alt = finger.get(ev.pointerId); finger.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (finger.size === 1) {
        const dx = ev.clientX - alt[0], dy = ev.clientY - alt[1];
        if (!bewegt && Math.abs(dx) + Math.abs(dy) > 3) { bewegt = true; ziel.classList.add('lk-zieht'); try { ziel.setPointerCapture(ev.pointerId); } catch (e) { /* ohne Fang geht es auch */ } }
        if (bewegt) { const m = massstab(); an.x -= dx / m; an.y -= dy / m; plane(); }
      } else if (finger.size === 2) {
        const [a, b] = Array.from(finger.values()), d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = ziel.getBoundingClientRect();
        if (abstand && d > 0) zoom(d / abstand, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        abstand = d; bewegt = true;
      }
    });
    const los = ev => { finger.delete(ev.pointerId); abstand = 0; ziel.classList.remove('lk-zieht'); };
    ziel.addEventListener('pointerup', los); ziel.addEventListener('pointercancel', los);
    ziel.addEventListener('click', ev => { if (bewegt) { ev.stopPropagation(); ev.preventDefault(); bewegt = false; return; } if (!ev.target.closest('.lk-blase,.lk-knoepfe')) { abwahl(); plane(); } }, true);
    ziel.addEventListener('wheel', ev => { ev.preventDefault(); const r = ziel.getBoundingClientRect(); zoom(ev.deltaY > 0 ? 1 / 1.25 : 1.25, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    ziel.addEventListener('keydown', ev => {
      if (ev.target !== ziel) return;
      const s = 60 / massstab();
      if (ev.key === 'ArrowLeft') an.x -= s; else if (ev.key === 'ArrowRight') an.x += s; else if (ev.key === 'ArrowUp') an.y -= s; else if (ev.key === 'ArrowDown') an.y += s;
      else if (ev.key === '+' || ev.key === '=') return zoom(1.4); else if (ev.key === '-') return zoom(1 / 1.4); else if (ev.key === 'Escape') abwahl(); else return;
      ev.preventDefault(); plane();
    });
    plus.addEventListener('click', () => zoom(1.5)); minus.addEventListener('click', () => zoom(1 / 1.5));

    // Sprung-Knöpfe und Legende
    const sprung = opt.sprung || document.getElementById('lk-sprung');
    if (sprung && alle.length) {
      sprung.textContent = '';
      const knopf = (text, tun) => { const k = html('button', 'lk-sprungknopf', sprung, text); k.type = 'button'; k.addEventListener('click', tun); };
      knopf('Alles', () => zeige(boxVon(alle)));
      for (const s of Array.isArray(daten.standorte) ? daten.standorte : []) {
        if (!s || typeof s.name !== 'string' || !Array.isArray(s.mitte) || !Number.isFinite(s.mitte[0]) || !Number.isFinite(s.mitte[1])) continue;
        const hier = gebaeude.filter(g => g.id && s.id && daten.gebaeude.some(r => r.id === g.id && r.standort === s.id));
        knopf(s.name, () => { if (hier.length) zeige(boxVon(hier), 2.2); else { an.x = lonX(s.mitte[0]); an.y = latY(s.mitte[1]); an.z = 17; plane(); } });
      }
    }
    const legende = opt.legende || document.getElementById('lk-legende');
    if (legende) {
      legende.textContent = '';
      for (const l of Array.isArray(daten.legende) ? daten.legende : []) {
        if (!l || typeof l.name !== 'string' || !farbeOk(l.farbe)) continue;
        const s = html('span', 'lk-leg', legende); const p = html('i', 'lk-punkt', s); p.style.background = l.farbe; s.appendChild(document.createTextNode(l.name));
      }
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(plane).observe(ziel); else addEventListener('resize', plane);
    if (alle.length) zeige(boxVon(alle)); else plane();
    return { zeige, waehle: id => { const o = alle.find(x => x.id === id); if (o) waehle(o); }, stand: () => Object.assign({}, an) };
  }

  function punkteFaerben() {
    for (const p of document.querySelectorAll('.lk-punkt[data-farbe]')) if (farbeOk(p.dataset.farbe)) p.style.background = p.dataset.farbe;
  }

  window.Landkarte = { start, pruefen };
  document.addEventListener('DOMContentLoaded', () => {
    punkteFaerben();
    const ziel = document.getElementById('lk-karte');
    if (!ziel || !ziel.dataset.quelle) return;
    fetch(ziel.dataset.quelle, { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error('Status ' + r.status); return r.json(); })
      .then(d => { window.Landkarte.karte = start(ziel, d); })
      .catch(() => { ziel.textContent = ''; const p = document.createElement('p'); p.className = 'lk-warten'; p.textContent = 'Die Karte lässt sich gerade nicht laden. Bitte die Seite neu laden.'; ziel.appendChild(p); });
  });
})();
