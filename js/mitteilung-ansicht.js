// „Mitteilungen einschalten“ unter „Freigaben“ bei „Anmeldungen bestätigen“ (A064 Stufe 2, Funktion „anmelde_mitteilung“). Nur Verwalter-Handys.
// Der Knopf fragt die Erlaubnis des Handys, meldet ein Abo an und schickt es als beglaubigte Meldung an den Laptop (js/mitteilung.js).
import { kannMitteilung, mitteilungAboLesen, mitteilungAnmelden, mitteilungAbmelden, mitteilungAboBauen, mitteilungSchluesselFuer } from './mitteilung.js';
import { b64uLesen } from './anmelden.js';

const SAETZE = {
  kannNicht: 'Dieses Handy kann keine Mitteilungen zeigen.',
  warten: 'Der Laptop meldet sich gleich mit dem Nötigen. Bitte gleich noch einmal versuchen.',
  an: 'Eingeschaltet.',
  blockiert: 'Mitteilungen sind für die Hof-App gesperrt. Bitte in den Einstellungen des Handys erlauben.',
  abgelehnt: 'Nicht eingeschaltet: Du hast die Erlaubnis nicht gegeben. Du kannst es noch einmal versuchen.',
  fehler: 'Das Einschalten ging nicht. Du kannst es noch einmal versuchen.',
  senden: 'Das Melden an den Laptop ging nicht. Du kannst es noch einmal versuchen.',
  aus: 'Ausgeschaltet.',
};

// ctx: { $, geraet(), modus(), config, stand(), privaterSchluessel(), nachrichten, postausgang(), meldung(), holen() } – alles von app.js
export function baueMitteilung(ctx) {
  const { $ } = ctx;
  let busy = false;

  const einAus = async () => {
    const abo = await mitteilungAboLesen();
    const key = mitteilungSchluesselFuer(ctx.stand(), ctx.modus());
    if (!abo || !key) return false;
    const gleich = abo.options && abo.options.applicationServerKey ? (() => {
      const a = new Uint8Array(abo.options.applicationServerKey), b = b64uLesen(key);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    })() : false;
    return gleich && globalThis.Notification && Notification.permission === 'granted';
  };

  async function zeigen(fehlerBehalten = false) {
    const block = $('#mitteilung-block');
    if (!block) return;
    const g = ctx.geraet();
    const stand = $('#mitteilung-stand'), knopf = $('#b-mitteilung'), fehler = $('#mitteilung-fehler');
    if (!fehlerBehalten) fehler.hidden = true;
    block.hidden = !(g && g.rolle === 'admin');
    if (block.hidden) return;
    if (!kannMitteilung()) { stand.textContent = SAETZE.kannNicht; stand.hidden = false; knopf.hidden = true; return; }
    knopf.hidden = false;
    const an = await einAus();
    stand.textContent = an ? SAETZE.an : (globalThis.Notification && Notification.permission === 'denied' ? SAETZE.blockiert : '');
    stand.hidden = !stand.textContent;
    knopf.textContent = an ? 'Mitteilungen ausschalten' : 'Mitteilungen einschalten';
    knopf.classList.toggle('haupt', false);
    knopf.classList.toggle('neben', true);
    knopf.dataset.zustand = an ? 'an' : 'aus';
  }

  async function melden(aktion, abo, key) {
    const privatKey = await ctx.privaterSchluessel();
    if (!privatKey) throw new Error('kein Schlüssel');
    const r = await mitteilungAboBauen({ aktion, abo, schluessel: key, instanz: ctx.modus(), geraet: ctx.geraet(), config: ctx.config, privatKey });
    await ctx.nachrichten.speichere({
      id: r.id, erstellt: Date.now(), status: 'wartet', ziel: r.instanz, art: 'antwort', frage: 'mitteilung-abo',
      vorschau: aktion === 'an' ? 'Mitteilungen eingeschaltet' : 'Mitteilungen ausgeschaltet', sprache: 0, fotos: 0, doks: 0,
      umschlag: new Blob([r.umschlag], { type: 'application/octet-stream' }),
    });
    await ctx.postausgang();                                           // gleich senden (ohne Netz bleibt sie in der Warteschlange)
  }

  async function umschalten() {
    const g = ctx.geraet();
    if (busy || !g || g.rolle !== 'admin' || !kannMitteilung()) return false;
    busy = true;
    const knopf = $('#b-mitteilung'), fehler = $('#mitteilung-fehler');
    knopf.disabled = true; fehler.hidden = true;
    const sag = t => { fehler.textContent = t; fehler.hidden = false; };
    try {
      const key = mitteilungSchluesselFuer(ctx.stand(), ctx.modus());
      if (knopf.dataset.zustand === 'an') {
        await mitteilungAbmelden();
        try { await melden('aus', null, key || ''); } catch { sag(SAETZE.senden); return false; }
        ctx.meldung(SAETZE.aus);
        return true;
      }
      if (!key) { if (ctx.holen) ctx.holen(); sag(SAETZE.warten); return false; }
      let abo;
      try { abo = await mitteilungAnmelden(key); }
      catch (e) { sag(e && e.message === 'abgelehnt' ? SAETZE.abgelehnt : SAETZE.fehler); return false; }
      try { await melden('an', abo, key); } catch { await mitteilungAbmelden(); sag(SAETZE.senden); return false; }   // dann lieber gar kein Abo als eines, von dem der Laptop nichts weiß
      ctx.meldung('Mitteilungen sind eingeschaltet.');
      return true;
    } finally { busy = false; knopf.disabled = false; await zeigen(true); }
  }

  const knopf = $('#b-mitteilung');
  if (knopf) knopf.addEventListener('click', () => { umschalten(); });
  return { zeigen, umschalten };
}
