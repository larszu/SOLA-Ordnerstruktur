'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Verwaltet die Lightroom-Vorgaben aus zwei Quellen:
 *
 * - **mitgeliefert** — die Dateien in `resources/presets`, die mit der App
 *   ausgeliefert werden. Sie sind im gepackten Build schreibgeschützt.
 * - **eigen** — Dateien, die die Nutzerin oder der Nutzer selbst hinzugefügt
 *   hat. Sie liegen im Benutzerdatenordner der App und bleiben bei einem
 *   Update erhalten.
 *
 * Eine eigene Datei mit demselben Dateinamen ersetzt die mitgelieferte. So
 * lässt sich eine Vorgabe austauschen, ohne die Auslieferung anzufassen — und
 * durch Löschen der eigenen Datei kommt die mitgelieferte zurück.
 */

const EXPORT_ENDUNG = '.lrtemplate';
const DEVELOP_ENDUNG = '.xmp';

/** Ordnernamen unterhalb des Benutzerdatenordners. */
const UNTERORDNER = { export: 'export', develop: 'develop' };
const MANIFEST = 'manifest.json';

/**
 * Bezeichnung und Kurzform der mitgelieferten Exportvorgaben. Beides landet in
 * der `.lrtemplate` (als Name und im Dateinamen-Token) und lässt sich für
 * eigene Vorgaben in der Oberfläche eintragen.
 */
const MITGELIEFERTE_META = {
  'HighQuality_HQ.lrtemplate': { lang: 'HighQuality (HQ)', kurz: 'HQ' },
  'LowQuality_LQ.lrtemplate': { lang: 'LowQuality (LQ)', kurz: 'LQ' },
  'RAW.lrtemplate': { lang: 'RAW', kurz: 'RAW' },
};

/** @param {string} datei */
function typVonDatei(datei) {
  const endung = path.extname(datei).toLowerCase();
  if (endung === EXPORT_ENDUNG) return 'export';
  if (endung === DEVELOP_ENDUNG) return 'develop';
  return null;
}

/** Liest die Dateien eines Ordners, ohne bei einem fehlenden Ordner zu stolpern. */
function dateienIn(ordner, endung) {
  try {
    return fs
      .readdirSync(ordner, { withFileTypes: true })
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === endung)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** @returns {{deaktiviert: string[], meta: Object<string, {lang: string, kurz: string}>}} */
function leseManifest(userDir) {
  try {
    const roh = JSON.parse(fs.readFileSync(path.join(userDir, MANIFEST), 'utf8'));
    return {
      deaktiviert: Array.isArray(roh.deaktiviert) ? roh.deaktiviert.map(String) : [],
      meta: roh.meta && typeof roh.meta === 'object' ? roh.meta : {},
    };
  } catch {
    return { deaktiviert: [], meta: {} };
  }
}

function schreibeManifest(userDir, manifest) {
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Leitet aus einem Dateinamen eine brauchbare Bezeichnung und Kurzform ab.
 * `Meine_Vorgabe_XY.lrtemplate` wird zu `Meine Vorgabe XY` / `XY`.
 */
function metaAusDateiname(datei) {
  const basis = path.basename(datei, path.extname(datei));
  const lang = basis.replace(/[_-]+/g, ' ').trim() || basis;
  const letztes = lang.split(' ').filter(Boolean).pop() || 'EXP';
  return { lang, kurz: letztes.slice(0, 6).toUpperCase() };
}

/**
 * @typedef {Object} Vorgabe
 * @property {string} datei    Dateiname, zugleich die Kennung
 * @property {'export'|'develop'} typ
 * @property {'mitgeliefert'|'eigen'} quelle
 * @property {string} pfad     Absoluter Pfad der wirksamen Datei
 * @property {boolean} aktiv   Wird beim Installieren berücksichtigt
 * @property {boolean} ersetzt Eigene Datei überschreibt eine mitgelieferte
 * @property {string} [lang]   Nur bei Exportvorgaben
 * @property {string} [kurz]   Nur bei Exportvorgaben
 */

/**
 * Listet alle wirksamen Vorgaben, eigene vor mitgelieferten.
 * @param {{bundledDir: string, userDir: string}} ordner
 * @returns {Vorgabe[]}
 */
function listPresets({ bundledDir, userDir }) {
  const manifest = leseManifest(userDir);
  /** @type {Map<string, Vorgabe>} */
  const nachDatei = new Map();

  const aufnehmen = (datei, typ, quelle, pfad) => {
    const vorhanden = nachDatei.get(datei);
    const eintrag = {
      datei,
      typ,
      quelle,
      pfad,
      aktiv: !manifest.deaktiviert.includes(datei),
      ersetzt: quelle === 'eigen' && Boolean(vorhanden),
    };
    if (typ === 'export') {
      const meta = manifest.meta[datei] || MITGELIEFERTE_META[datei] || metaAusDateiname(datei);
      eintrag.lang = String(meta.lang || '');
      eintrag.kurz = String(meta.kurz || '');
    }
    nachDatei.set(datei, eintrag);
  };

  for (const [typ, endung] of [['export', EXPORT_ENDUNG], ['develop', DEVELOP_ENDUNG]]) {
    for (const datei of dateienIn(bundledDir, endung)) {
      aufnehmen(datei, typ, 'mitgeliefert', path.join(bundledDir, datei));
    }
  }
  for (const [typ, endung] of [['export', EXPORT_ENDUNG], ['develop', DEVELOP_ENDUNG]]) {
    const ordner = path.join(userDir, UNTERORDNER[typ]);
    for (const datei of dateienIn(ordner, endung)) {
      aufnehmen(datei, typ, 'eigen', path.join(ordner, datei));
    }
  }

  // Exportvorgaben zuerst, darin eigene vor mitgelieferten, sonst nach Name.
  return [...nachDatei.values()].sort(
    (a, b) => a.typ.localeCompare(b.typ) || a.datei.localeCompare(b.datei, 'de'),
  );
}

/**
 * Übernimmt eine Datei als eigene Vorgabe.
 * @param {{quellPfad: string, userDir: string, bundledDir: string}} optionen
 * @returns {{ok: boolean, datei?: string, typ?: string, grund?: string}}
 */
function importPreset({ quellPfad, userDir, bundledDir }) {
  const datei = path.basename(quellPfad);
  const typ = typVonDatei(datei);
  if (!typ) {
    return { ok: false, grund: `Unbekannter Dateityp — erwartet wird ${EXPORT_ENDUNG} oder ${DEVELOP_ENDUNG}.` };
  }

  const zielOrdner = path.join(userDir, UNTERORDNER[typ]);
  try {
    fs.mkdirSync(zielOrdner, { recursive: true });
    fs.copyFileSync(quellPfad, path.join(zielOrdner, datei));
  } catch (err) {
    return { ok: false, grund: err.message };
  }

  const manifest = leseManifest(userDir);
  // Eine zuvor abgewählte Vorgabe wird durch das Einlesen wieder aktiv.
  manifest.deaktiviert = manifest.deaktiviert.filter((d) => d !== datei);
  if (typ === 'export' && !manifest.meta[datei]) {
    manifest.meta[datei] = MITGELIEFERTE_META[datei] || metaAusDateiname(datei);
  }
  try {
    schreibeManifest(userDir, manifest);
  } catch (err) {
    return { ok: false, grund: err.message };
  }

  const ersetzt = fs.existsSync(path.join(bundledDir, datei));
  return { ok: true, datei, typ, ersetzt };
}

/**
 * Entfernt eine eigene Vorgabe. Eine dadurch wieder freigelegte mitgelieferte
 * Vorgabe wird automatisch wieder wirksam.
 * @returns {{ok: boolean, grund?: string, wiederhergestellt?: boolean}}
 */
function removePreset({ datei, userDir, bundledDir }) {
  const typ = typVonDatei(datei);
  if (!typ) return { ok: false, grund: 'Unbekannter Dateityp.' };

  const pfad = path.join(userDir, UNTERORDNER[typ], datei);
  if (!fs.existsSync(pfad)) {
    return { ok: false, grund: 'Das ist keine eigene Vorgabe — mitgelieferte lassen sich nur abwählen.' };
  }
  try {
    fs.unlinkSync(pfad);
  } catch (err) {
    return { ok: false, grund: err.message };
  }

  const manifest = leseManifest(userDir);
  delete manifest.meta[datei];
  try {
    schreibeManifest(userDir, manifest);
  } catch (err) {
    return { ok: false, grund: err.message };
  }
  return { ok: true, wiederhergestellt: fs.existsSync(path.join(bundledDir, datei)) };
}

/** Schaltet eine Vorgabe für das Installieren an oder ab. */
function setPresetAktiv({ datei, aktiv, userDir }) {
  const manifest = leseManifest(userDir);
  const ohne = manifest.deaktiviert.filter((d) => d !== datei);
  manifest.deaktiviert = aktiv ? ohne : [...ohne, datei];
  try {
    schreibeManifest(userDir, manifest);
    return { ok: true };
  } catch (err) {
    return { ok: false, grund: err.message };
  }
}

/** Speichert Bezeichnung und Kurzform einer Exportvorgabe. */
function setPresetMeta({ datei, lang, kurz, userDir }) {
  if (typVonDatei(datei) !== 'export') return { ok: false, grund: 'Nur Exportvorgaben haben diese Angaben.' };
  const manifest = leseManifest(userDir);
  manifest.meta[datei] = { lang: String(lang || '').trim(), kurz: String(kurz || '').trim() };
  try {
    schreibeManifest(userDir, manifest);
    return { ok: true };
  } catch (err) {
    return { ok: false, grund: err.message };
  }
}

/**
 * Verwirft alle eigenen Vorgaben und Anpassungen — die App steht danach wieder
 * im Auslieferungszustand.
 */
function resetPresets({ userDir }) {
  try {
    for (const unter of Object.values(UNTERORDNER)) {
      fs.rmSync(path.join(userDir, unter), { recursive: true, force: true });
    }
    fs.rmSync(path.join(userDir, MANIFEST), { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, grund: err.message };
  }
}

module.exports = {
  EXPORT_ENDUNG,
  DEVELOP_ENDUNG,
  MITGELIEFERTE_META,
  typVonDatei,
  metaAusDateiname,
  listPresets,
  importPreset,
  removePreset,
  setPresetAktiv,
  setPresetMeta,
  resetPresets,
};
