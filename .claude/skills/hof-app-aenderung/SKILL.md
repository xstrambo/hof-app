---
name: hof-app-aenderung
description: Pflicht-Ablauf für jede Änderung an der Hof-App (app.js, js/, index.html, styles.css, sw.js, funktionen.json). Vor dem ersten Bearbeiten und noch einmal vor dem Commit lesen. Deckt ab – neue Funktion erst nur im Test-Modus, Offline-Speicher (sw.js) nachziehen, Tests, Texte für die Leute am Hof, Commit-Nachricht.
---

# Änderung an der Hof-App

Die Hof-App ist EINE App für Echt und Test, liegt auf GitHub Pages und wird am Handy offline gehalten.
Es gibt keinen Build-Schritt und kein package.json: was im Repo steht, läuft so auf den Handys.
Daraus folgen vier Regeln, die bei jeder Änderung gelten.

## 1. Neues erscheint zuerst nur im Test-Modus

- Jede neue Funktion bekommt einen Namen (klein, mit Unterstrich, z. B. `hofkarte_bearbeiten`) und einen Eintrag in `funktionen.json` mit dem Wert `"test"`.
- In der Oberfläche: das neue Element bekommt `data-funktion="name"`. Verstecken erledigt `styles.css`, kein eigenes JavaScript nötig.
- Im Programm: `funktionAktiv('name')` (von außen `hofApp.funktion('name')`).
- Auf `"alle"` wird erst gestellt, wenn Niklas zum Punkt in der nummerierten Änderungsliste (A0xx) Ja gesagt hat. Nie von selbst umstellen.
- Bestehendes Verhalten hängt nicht an einer Funktion und wird nicht nachträglich dahinter versteckt.
- Die Regeln im Einzelnen stehen im Kopf von `js/funktionen.js`.

## 2. Offline-Speicher nachziehen (`sw.js`)

Vergisst man das, sehen die Handys die Änderung nicht oder die App startet ohne Netz nicht mehr.

- Bei jeder Änderung an einer ausgelieferten Datei `VERSION` um eins hochzählen (`hof-app-v22` → `hof-app-v23`).
- Jede neue Datei (auch unter `js/`, `test/`, `vendor/`, `icons/`) in die Liste `DATEIEN` eintragen; gelöschte Dateien austragen. Ein Eintrag, den es nicht gibt, lässt die ganze Installation scheitern.
- Prüfen, ob jede eingetragene Datei da ist (gibt nur die Anzahl aus, wenn alles stimmt):

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('sw.js','utf8');const l=eval(s.match(/const DATEIEN = (\[[\s\S]*?\]);/)[1]);for(const f of l)if(f!=='./'&&!fs.existsSync(f))console.log('FEHLT',f);console.log(l.length,'geprueft')"
```

## 3. Tests

- Aufruf im Ordner der App: `node --test test/`
- Rechnende Logik gehört in ein eigenes Modul unter `js/` ohne Zugriff auf `document`/`window`, damit sie so getestet werden kann (Vorbild: `js/gs1.js` mit `test/gs1.test.mjs`).
- Testdaten sind erfunden (Testhof Pappelweide), nie echte Namen, Nummern oder Schlüssel vom Hof.
- Im Browser ohne echten Briefkasten ausprobieren: lokal ausliefern und mit `?attrappe` öffnen (wirkt nur auf `localhost`; erster Einladungscode `ADM-1N1`, siehe `js/briefkasten.js`). Für Tests im Browser gibt es `window.hofApp`.

## 4. Sprache

- Texte in der App: kurzes, einfaches Deutsch für Leute am Hof, mit echten Umlauten. Keine Fachwörter und kein Englisch („Knopf“, „Reiter“, „Briefkasten“, „Freigabe“ – nicht „Button“, „Tab“, „Server“).
- Namen im Code und Kommentare ebenfalls auf Deutsch, im Stil der Nachbarzeilen. Kommentare sagen, warum etwas so ist.

## Geheimes

In `config.js` steht nur Öffentliches (Adressen, öffentliche Schlüssel). Private Schlüssel, Supabase-Service-Schlüssel oder API-Schlüssel (z. B. Mistral) gehören nie ins Repo – sie liegen als Geheimnis bei den Supabase-Funktionen `briefkasten`, `briefkasten-test` und `transkribieren` (Projekt „Hof-App“).

## Vor dem Commit

1. `node --test test/` läuft durch.
2. `sw.js`: `VERSION` erhöht, `DATEIEN` stimmt.
3. Neue Funktion steht in `funktionen.json` auf `"test"`.
4. Commit-Nachricht: ein deutscher Satz, der sagt, was man am Handy jetzt sieht oder kann; Nummern aus der Änderungsliste in Klammern am Ende, z. B. `Hof-App: Hof-Karte am Handy beschriften (A037)`.
