// Anmelde-Freigabe am Handy (A064): Handy einrichten und eine Anmelde-Anfrage mit Fingerabdruck bestätigen.
// Geprüft gegen seiten/freigabe_kern.py mit probe_webauthn.py (Edge, virtuelles Prüfgerät). Der Text der Anfrage muss Zeichen für
// Zeichen gleich sein wie in freigabe_kern.anfrage_text().
const ANMELDE_KOPF = 'hof-app anmelde-freigabe v1';
const ANMELDE_FELDER = ['id', 'seite', 'adresse', 'wer', 'grund', 'erstellt', 'gueltig_bis', 'zufall'];

export function anmeldeText(anfrage) {
  return [ANMELDE_KOPF, ...ANMELDE_FELDER.map((f) => String(anfrage[f]))].join('\n');
}

export async function anmeldeChallenge(anfrage) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(anmeldeText(anfrage))));
}

export function b64u(puffer) {
  let s = '';
  for (const b of new Uint8Array(puffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uLesen(text) {
  const t = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
}

// Einmal je Handy: legt im Handy einen Schlüssel an, der nur nach Fingerabdruck, Gesicht oder Geräte-PIN benutzbar ist.
// Zurück: Kennung und öffentlicher Schlüssel (beides darf jeder sehen). Der geheime Teil verlässt das Handy nie.
export async function anmeldeHandyEinrichten(name) {
  const c = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Hof-App', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name, displayName: name },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 120000,
    },
  });
  const spki = c.response.getPublicKey();
  if (!spki || c.response.getPublicKeyAlgorithm() !== -7) throw new Error('Dieses Handy liefert keinen passenden Schlüssel.');
  return { kennung: b64u(c.rawId), schluessel: b64u(spki) };
}

// Je Anfrage: Das Handy fragt nach Fingerabdruck, Gesicht oder PIN und unterschreibt genau diese Anfrage.
export async function anmeldeBestaetigen(anfrage, kennungen) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: await anmeldeChallenge(anfrage),
      rpId: location.hostname,
      userVerification: 'required',
      timeout: 120000,
      allowCredentials: kennungen.map((k) => ({ type: 'public-key', id: b64uLesen(k) })),
    },
  });
  return {
    kennung: b64u(a.rawId),
    authenticatorData: b64u(a.response.authenticatorData),
    clientDataJSON: b64u(a.response.clientDataJSON),
    signature: b64u(a.response.signature),
  };
}
