'use strict';

/**
 * Headless-Durchlauf durch die fertige App.
 *
 * Startet den echten Hauptprozess, klickt sich durch die Oberfläche, legt eine
 * Ordnerstruktur auf der Platte an und vergleicht sie mit dem geplanten Baum.
 * Nebenbei entstehen die Screenshots für die README.
 *
 *   npm run smoke              (unter Linux via xvfb-run)
 *   npm run smoke -- --keep    Zielordner nicht aufräumen
 *
 * Beendet sich mit Code 1, sobald eine Prüfung fehlschlägt.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const SCREENSHOTS = path.join(WURZEL, 'docs', 'screenshots');
const BEHALTEN = process.argv.includes('--keep');

// Eigene Vorgaben in einen Wegwerfordner umleiten, damit ein echter
// Benutzerdatenordner vom Testlauf unberührt bleibt.
const arbeitsordner = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-smoke-'));
process.env.SOLA_USER_PRESETS = path.join(arbeitsordner, 'presets');

// Auf CI-Runnern gibt es keine GPU. Ohne Software-Rendering liefert
// capturePage() dort nur einen UnknownVizError. Muss vor dem ready-Ereignis
// stehen, also vor dem Laden des Hauptprozesses.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

require(path.join(WURZEL, 'src', 'main', 'main.js'));

const { buildPlan } = require(path.join(WURZEL, 'src', 'core', 'structure'));
const presetStore = require(path.join(WURZEL, 'src', 'core', 'presetStore'));

const warten = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];

function pruefe(bedingung, beschreibung, detail) {
  if (bedingung) {
    console.log(`  ok   ${beschreibung}`);
  } else {
    console.error(`  FEHL ${beschreibung}${detail ? ` — ${detail}` : ''}`);
    fehler.push(beschreibung);
  }
}

/**
 * Nimmt das Fenster auf. Mit `zuAbschnitt` wird vorher dorthin gescrollt,
 * damit der Screenshot den gemeinten Teil der Oberfläche zeigt.
 */
async function screenshot(win, name, zuAbschnitt) {
  if (zuAbschnitt) {
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(zuAbschnitt)}).scrollIntoView({ block: 'start' })`,
      true,
    );
    await warten(400);
  } else {
    await win.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
    await warten(200);
  }
  // Ein misslungener Screenshot darf die übrigen Prüfungen nicht verschlucken.
  try {
    const bild = await win.webContents.capturePage();
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(SCREENSHOTS, name), bild.toPNG());
    console.log(`  bild ${name}`);
  } catch (err) {
    console.error(`  FEHL Screenshot ${name} — ${err.message}`);
    fehler.push(`Screenshot ${name}`);
  }
}

/** Zählt alle Ordner unterhalb eines Pfades. */
function zaehleOrdner(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .reduce((summe, e) => summe + 1 + zaehleOrdner(path.join(dir, e.name)), 0);
}

/** Die Konfiguration, die der Testlauf in der Oberfläche einstellt. */
const TEST_CONFIG = {
  teens: { start: '2026-06-13', bereiche: ['foto', 'video', 'orga'], fotografen: ['Lars', 'Maja'], videografen: ['Jonas'] },
  kids: { start: '2026-08-01', bereiche: ['showfiles'], fotografen: [], videografen: [] },
};

/** Füllt das Formular so, wie es ein Klick durch die Oberfläche täte. */
const FORMULAR_FUELLEN = `(async () => {
  const config = ${JSON.stringify(TEST_CONFIG)};
  const anhaken = (el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); };

  for (const [schluessel, daten] of Object.entries(config)) {
    const karte = document.querySelector('.sola[data-sola="' + schluessel + '"]');
    anhaken(karte.querySelector('.sola-aktiv'));

    const start = karte.querySelector('.sola-start');
    start.value = daten.start;
    start.dispatchEvent(new Event('change', { bubbles: true }));

    for (const bereich of daten.bereiche) anhaken(karte.querySelector('[data-bereich="' + bereich + '"]'));

    for (const rolle of ['fotografen', 'videografen']) {
      daten[rolle].forEach((name, i) => {
        const feld = karte.querySelector('.namen-spalte[data-rolle="' + rolle + '"] input[data-index="' + i + '"]');
        feld.value = name;
        feld.dispatchEvent(new Event('input', { bubbles: true }));
        feld.dispatchEvent(new Event('blur', { bubbles: true }));
      });
    }
  }

  const kuerzel = document.getElementById('kuerzel');
  kuerzel.value = 'L.Z.';
  kuerzel.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise((r) => setTimeout(r, 500));
  document.getElementById('vorschauBox').open = true;
  await new Promise((r) => setTimeout(r, 300));

  return {
    planInfo: document.getElementById('planInfo').textContent,
    vorschauZeilen: document.getElementById('vorschauBaum').textContent.split('\\n').filter(Boolean).length,
    presetsAktiv: !document.getElementById('btnPresets').disabled,
    teensNamenFrei: [...document.querySelectorAll('.sola[data-sola="teens"] .namen-spalte input')].filter((i) => !i.disabled).length,
    kidsNamenFrei: [...document.querySelectorAll('.sola[data-sola="kids"] .namen-spalte input')].filter((i) => !i.disabled).length,
  };
})()`;

/** Misst, ob der Seiteninhalt in die Fensterbreite passt. */
const LAYOUT_MESSEN = `(() => ({
  breite: document.documentElement.clientWidth,
  inhaltsbreite: document.documentElement.scrollWidth,
  tabelleScrollt: (() => {
    const box = document.querySelector('.tabelle-scroll');
    return box ? box.scrollWidth > box.clientWidth : false;
  })(),
  solaSpalten: getComputedStyle(document.getElementById('solas')).gridTemplateColumns.split(' ').length,
}))()`;

app.whenReady().then(async () => {
  let ziel = path.join(arbeitsordner, 'ziel');
  try {
    await warten(2500);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('Es wurde kein Fenster geöffnet.');

    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) {
        console.error(`  FEHL Renderer-Fehler: ${e.message}`);
        fehler.push('Renderer-Fehler');
      }
    });
    const imFenster = (js) => win.webContents.executeJavaScript(js, true);

    console.log('\n· Startzustand');
    await screenshot(win, '01-start.png');
    const startVorgaben = await imFenster('zustand.vorgaben.length');
    pruefe(startVorgaben === 5, 'die fünf mitgelieferten Vorgaben sind gelistet', `gelistet: ${startVorgaben}`);

    console.log('\n· Formular ausfüllen');
    const zustand = await imFenster(FORMULAR_FUELLEN);
    const plan = buildPlan({
      teens: {
        aktiv: true,
        start: TEST_CONFIG.teens.start,
        bereiche: Object.fromEntries(TEST_CONFIG.teens.bereiche.map((b) => [b, true])),
        fotografen: TEST_CONFIG.teens.fotografen,
        videografen: TEST_CONFIG.teens.videografen,
      },
      kids: {
        aktiv: true,
        start: TEST_CONFIG.kids.start,
        bereiche: { showfiles: true },
        fotografen: [],
        videografen: [],
      },
    });
    pruefe(
      zustand.vorschauZeilen === plan.ordner.length,
      'die Vorschau zeigt genau den geplanten Baum',
      `Vorschau ${zustand.vorschauZeilen}, Plan ${plan.ordner.length}`,
    );
    pruefe(zustand.planInfo.includes('Sola_2026'), 'das Solajahr kommt aus dem Startdatum', zustand.planInfo);
    pruefe(zustand.teensNamenFrei === 20, 'Foto und Video geben je zehn Namensfelder frei', String(zustand.teensNamenFrei));
    pruefe(zustand.kidsNamenFrei === 0, 'ohne Foto/Video bleiben die Namensfelder gesperrt', String(zustand.kidsNamenFrei));
    await screenshot(win, '02-ausgefuellt.png');

    console.log('\n· Ordnerstruktur anlegen');
    fs.mkdirSync(ziel, { recursive: true });
    const meldung = await imFenster(`(async () => {
      zustand.pfad = ${JSON.stringify(ziel)};
      await aktualisiere();
      document.getElementById('btnErstellen').click();
      await new Promise((r) => setTimeout(r, 1500));
      return document.getElementById('meldungen').textContent;
    })()`);
    const aufPlatte = zaehleOrdner(ziel);
    pruefe(aufPlatte === plan.ordner.length, 'jeder geplante Ordner liegt auf der Platte', `${aufPlatte} von ${plan.ordner.length}`);
    pruefe(/angelegt/.test(meldung), 'die Erfolgsmeldung bleibt stehen', meldung.slice(0, 80));

    const tagesordner = fs
      .readdirSync(path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto'))
      .sort((a, b) => a.localeCompare(b, 'de'));
    pruefe(
      tagesordner[0] === '1_Tag_13-06-2026' && tagesordner[7] === '8_Tag_20-06-2026',
      'die Tagesordner sortieren nach Tag',
      tagesordner.join(', '),
    );
    pruefe(
      tagesordner[8] === 'LR Kataloge',
      '"LR Kataloge" steht hinter den Tagesordnern',
      tagesordner[8],
    );
    await screenshot(win, '03-erstellt.png', 'main > .karte:nth-of-type(3)');

    console.log('\n· Vorgaben verwalten');
    // Den Dateidialog überspringen und stattdessen direkt einlesen; alles
    // Weitere läuft danach über die echten IPC-Aufrufe der Oberfläche.
    const eigeneQuelle = path.join(arbeitsordner, 'Sonnenuntergang.xmp');
    fs.copyFileSync(path.join(WURZEL, 'resources', 'presets', 'SOLA_Draussen.xmp'), eigeneQuelle);
    const importiert = presetStore.importPreset({
      quellPfad: eigeneQuelle,
      userDir: process.env.SOLA_USER_PRESETS,
      bundledDir: path.join(WURZEL, 'resources', 'presets'),
    });
    pruefe(importiert.ok, 'eine eigene Vorgabe lässt sich einlesen', importiert.grund);

    const nachImport = await imFenster(`(async () => {
      zeigeVorgaben(await sola.presetsListe());
      await new Promise((r) => setTimeout(r, 200));
      const zeilen = [...document.querySelectorAll('#vorgabenListe tr')];
      return {
        anzahl: zeilen.length,
        eigene: zeilen.filter((z) => z.textContent.includes('eigen')).length,
        entfernenKnoepfe: document.querySelectorAll('#vorgabenListe .knopf-klein').length,
      };
    })()`);
    pruefe(nachImport.anzahl === 6, 'die eigene Vorgabe erscheint in der Tabelle', `Zeilen: ${nachImport.anzahl}`);
    pruefe(nachImport.eigene === 1, 'sie ist als "eigen" gekennzeichnet', String(nachImport.eigene));
    pruefe(nachImport.entfernenKnoepfe === 1, 'nur eigene Vorgaben lassen sich entfernen', String(nachImport.entfernenKnoepfe));
    await screenshot(win, '04-vorgaben.png', '.vorgaben');

    // Abwählen über die Oberfläche, inklusive Rückweg über das Manifest.
    const nachAbwahl = await imFenster(`(async () => {
      const zeile = [...document.querySelectorAll('#vorgabenListe tr')].find((z) => z.dataset.datei === 'RAW.lrtemplate');
      const box = zeile.querySelector('input[type=checkbox]');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return zustand.vorgaben.filter((v) => v.aktiv).length;
    })()`);
    pruefe(nachAbwahl === 5, 'eine abgewählte Vorgabe zählt nicht mehr mit', String(nachAbwahl));

    const nachEntfernen = await imFenster(`(async () => {
      const zeile = [...document.querySelectorAll('#vorgabenListe tr')].find((z) => z.dataset.datei === 'Sonnenuntergang.xmp');
      zeile.querySelector('.knopf-klein').click();
      await new Promise((r) => setTimeout(r, 500));
      return document.querySelectorAll('#vorgabenListe tr').length;
    })()`);
    pruefe(nachEntfernen === 5, 'nach dem Entfernen bleiben die mitgelieferten übrig', String(nachEntfernen));

    console.log('\n· Layout');
    for (const [breite, hoehe, name] of [[1180, 900, null], [760, 900, null], [620, 900, '05-schmal.png']]) {
      win.setSize(breite, hoehe);
      await warten(500);
      const layout = await imFenster(LAYOUT_MESSEN);
      pruefe(
        layout.inhaltsbreite <= layout.breite + 1,
        `bei ${breite} px scrollt die Seite nicht seitlich`,
        `Inhalt ${layout.inhaltsbreite} px, Fenster ${layout.breite} px`,
      );
      if (breite <= 900) {
        pruefe(layout.solaSpalten === 1, `bei ${breite} px stehen die Solas untereinander`, `${layout.solaSpalten} Spalten`);
      }
      if (name) await screenshot(win, name, breite <= 900 ? '.vorgaben' : undefined);
    }
  } catch (err) {
    console.error('\nAbbruch:', err && err.stack ? err.stack : err);
    fehler.push(String(err));
  }

  if (BEHALTEN) {
    console.log(`\nArbeitsordner behalten: ${arbeitsordner}`);
  } else {
    fs.rmSync(arbeitsordner, { recursive: true, force: true });
  }

  console.log(fehler.length === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler.length} Prüfung(en) fehlgeschlagen.`);
  app.exit(fehler.length === 0 ? 0 : 1);
});
