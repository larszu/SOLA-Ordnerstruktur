'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Lightroom Classic legt seine Vorgaben je nach Betriebssystem woanders ab.
 * Windows: %APPDATA%\Adobe\Lightroom\...
 * macOS:   ~/Library/Application Support/Adobe/Lightroom/...
 *
 * @param {NodeJS.Platform} [plattform]
 * @param {Object} [env]
 * @returns {{basis: string, developPresets: string, exportPresets: string}}
 */
function lightroomPfade(plattform = process.platform, env = process.env) {
  let appData;
  if (plattform === 'win32') {
    appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (plattform === 'darwin') {
    appData = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    // Linux kennt Lightroom nicht; der Pfad dient nur der Vollständigkeit.
    appData = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  const basis = path.join(appData, 'Adobe', 'Lightroom');
  return {
    basis,
    developPresets: path.join(basis, 'Develop Presets'),
    exportPresets: path.join(basis, 'Export Presets', 'User Presets'),
  };
}

/** Die drei Exportvorgaben mit ihrer Langform / Kurzform für die Dateinamen. */
const EXPORT_PRESETS = [
  { datei: 'HighQuality_HQ.lrtemplate', lang: 'HighQuality (HQ)', kurz: 'HQ' },
  { datei: 'LowQuality_LQ.lrtemplate', lang: 'LowQuality (LQ)', kurz: 'LQ' },
  { datei: 'RAW.lrtemplate', lang: 'RAW', kurz: 'RAW' },
];

/** Die beiden Entwicklungsvorgaben – die werden unverändert kopiert. */
const DEVELOP_PRESETS = ['SOLA_Draussen.xmp', 'SOLA_Veranstaltungszelt.xmp'];

/**
 * Schreibt Jahr, Sola und Kürzel in eine `.lrtemplate`-Exportvorgabe.
 * Ersetzt genau die vier Zeilen, die das Original auch angefasst hat.
 *
 * @param {string} inhalt Dateiinhalt der Vorlage
 * @param {{jahr: string, sola: string, kuerzel: string, lang: string, kurz: string}} daten
 * @returns {{inhalt: string, fehlend: string[]}}
 */
function patchExportPreset(inhalt, daten) {
  const { jahr, sola, kuerzel, lang, kurz } = daten;
  const name = `SOLA${jahr}_${sola}_${lang}`;
  const tokens =
    '{{date_YY}}-{{date_MM}}-{{date_DD}}__{{date_Hour}}-{{date_Minute}}-{{date_Second}}__' +
    `SOLA${jahr}_${sola}_{{custom_token}}_${kurz}_{{image_name}}`;

  const ersetzungen = [
    { schluessel: 'internalName', zeile: `\tinternalName = "${name}",` },
    { schluessel: 'title', zeile: `\ttitle = "${name}",` },
    { schluessel: 'tokenCustomString', zeile: `\t\ttokenCustomString = "${kuerzel}",` },
    { schluessel: 'tokens', zeile: `\t\ttokens = "${tokens}",` },
  ];

  // Zeilenenden merken, damit die Datei so bleibt, wie Lightroom sie erwartet.
  const eol = inhalt.includes('\r\n') ? '\r\n' : '\n';
  const zeilen = inhalt.split(/\r?\n/);
  const gefunden = new Set();

  for (let i = 0; i < zeilen.length; i += 1) {
    for (const { schluessel, zeile } of ersetzungen) {
      // `tokens =` darf nicht auf `tokensArchivedToString2 =` anspringen.
      if (gefunden.has(schluessel)) continue;
      if (new RegExp(`(^|\\s)${schluessel}\\s*=`).test(zeilen[i])) {
        zeilen[i] = zeile;
        gefunden.add(schluessel);
        break;
      }
    }
  }

  const fehlend = ersetzungen.map((e) => e.schluessel).filter((s) => !gefunden.has(s));
  return { inhalt: zeilen.join(eol), fehlend };
}

/**
 * Kopiert alle Vorgaben nach Lightroom und passt die Exportvorgaben an.
 *
 * @param {Object} optionen
 * @param {string} optionen.presetsDir Ordner mit den mitgelieferten Vorlagen
 * @param {string} optionen.jahr    Zweistelliges Jahr, z.B. "26"
 * @param {string} optionen.sola    "Teens" oder "Kids"
 * @param {string} optionen.kuerzel z.B. "M.U."
 * @param {{developPresets: string, exportPresets: string}} [optionen.ziele]
 * @returns {{erfolg: boolean, installiert: string[], fehler: Array<{datei: string, grund: string}>,
 *            ziele: {developPresets: string, exportPresets: string}}}
 */
function installPresets({ presetsDir, jahr, sola, kuerzel, ziele = lightroomPfade() }) {
  const installiert = [];
  const fehler = [];

  for (const ordner of [ziele.developPresets, ziele.exportPresets]) {
    try {
      fs.mkdirSync(ordner, { recursive: true });
    } catch (err) {
      fehler.push({ datei: ordner, grund: err.message });
    }
  }

  for (const preset of EXPORT_PRESETS) {
    const quelle = path.join(presetsDir, preset.datei);
    const ziel = path.join(ziele.exportPresets, preset.datei);
    try {
      const roh = fs.readFileSync(quelle, 'utf8');
      const { inhalt, fehlend } = patchExportPreset(roh, {
        jahr,
        sola,
        kuerzel,
        lang: preset.lang,
        kurz: preset.kurz,
      });
      if (fehlend.length > 0) {
        fehler.push({ datei: preset.datei, grund: `Nicht gefunden: ${fehlend.join(', ')}` });
        continue;
      }
      fs.writeFileSync(ziel, inhalt, 'utf8');
      installiert.push(ziel);
    } catch (err) {
      fehler.push({ datei: preset.datei, grund: err.message });
    }
  }

  for (const datei of DEVELOP_PRESETS) {
    const ziel = path.join(ziele.developPresets, datei);
    try {
      fs.copyFileSync(path.join(presetsDir, datei), ziel);
      installiert.push(ziel);
    } catch (err) {
      fehler.push({ datei, grund: err.message });
    }
  }

  return { erfolg: fehler.length === 0, installiert, fehler, ziele };
}

module.exports = { lightroomPfade, patchExportPreset, installPresets, EXPORT_PRESETS, DEVELOP_PRESETS };
