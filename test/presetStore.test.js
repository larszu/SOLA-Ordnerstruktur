'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  listPresets,
  importPreset,
  removePreset,
  setPresetAktiv,
  setPresetMeta,
  resetPresets,
  metaAusDateiname,
  typVonDatei,
} = require('../src/core/presetStore');

const BUNDLED = path.join(__dirname, '..', 'resources', 'presets');

/** Legt einen leeren Benutzerordner an, der nach dem Test verschwindet. */
function userDirFuer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-presets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Schreibt eine Datei in einen temporären Ordner und gibt den Pfad zurück. */
function tempDatei(t, name, inhalt = 'x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-quelle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pfad = path.join(dir, name);
  fs.writeFileSync(pfad, inhalt);
  return pfad;
}

test('ohne eigene Vorgaben werden genau die mitgelieferten gelistet', (t) => {
  const userDir = userDirFuer(t);
  const liste = listPresets({ bundledDir: BUNDLED, userDir });

  assert.equal(liste.length, 5);
  assert.ok(liste.every((v) => v.quelle === 'mitgeliefert' && v.aktiv));
  assert.equal(liste.filter((v) => v.typ === 'export').length, 3);
  assert.equal(liste.filter((v) => v.typ === 'develop').length, 2);
});

test('mitgelieferte Exportvorgaben tragen ihre bekannten Angaben', (t) => {
  const userDir = userDirFuer(t);
  const hq = listPresets({ bundledDir: BUNDLED, userDir }).find((v) => v.datei === 'HighQuality_HQ.lrtemplate');
  assert.equal(hq.lang, 'HighQuality (HQ)');
  assert.equal(hq.kurz, 'HQ');
});

test('eine eigene Vorgabe kommt hinzu und ist sofort aktiv', (t) => {
  const userDir = userDirFuer(t);
  const quelle = tempDatei(t, 'Sonnenuntergang.xmp', '<x:xmpmeta/>');

  const ergebnis = importPreset({ quellPfad: quelle, userDir, bundledDir: BUNDLED });
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.typ, 'develop');
  assert.equal(ergebnis.ersetzt, false);

  const liste = listPresets({ bundledDir: BUNDLED, userDir });
  assert.equal(liste.length, 6);
  const neu = liste.find((v) => v.datei === 'Sonnenuntergang.xmp');
  assert.equal(neu.quelle, 'eigen');
  assert.equal(neu.aktiv, true);
  assert.equal(fs.readFileSync(neu.pfad, 'utf8'), '<x:xmpmeta/>');
});

test('eine gleichnamige eigene Datei ersetzt die mitgelieferte', (t) => {
  const userDir = userDirFuer(t);
  const quelle = tempDatei(t, 'SOLA_Draussen.xmp', 'MEINE FASSUNG');

  const ergebnis = importPreset({ quellPfad: quelle, userDir, bundledDir: BUNDLED });
  assert.equal(ergebnis.ersetzt, true);

  const liste = listPresets({ bundledDir: BUNDLED, userDir });
  // Sie ersetzt, sie kommt nicht dazu.
  assert.equal(liste.length, 5);
  const eintrag = liste.find((v) => v.datei === 'SOLA_Draussen.xmp');
  assert.equal(eintrag.quelle, 'eigen');
  assert.equal(eintrag.ersetzt, true);
  assert.equal(fs.readFileSync(eintrag.pfad, 'utf8'), 'MEINE FASSUNG');
});

test('nach dem Entfernen greift wieder die mitgelieferte Fassung', (t) => {
  const userDir = userDirFuer(t);
  importPreset({ quellPfad: tempDatei(t, 'SOLA_Draussen.xmp', 'MEINE'), userDir, bundledDir: BUNDLED });

  const ergebnis = removePreset({ datei: 'SOLA_Draussen.xmp', userDir, bundledDir: BUNDLED });
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.wiederhergestellt, true);

  const eintrag = listPresets({ bundledDir: BUNDLED, userDir }).find((v) => v.datei === 'SOLA_Draussen.xmp');
  assert.equal(eintrag.quelle, 'mitgeliefert');
  assert.equal(eintrag.pfad, path.join(BUNDLED, 'SOLA_Draussen.xmp'));
});

test('eine mitgelieferte Vorgabe lässt sich nicht löschen, nur abwählen', (t) => {
  const userDir = userDirFuer(t);
  const ergebnis = removePreset({ datei: 'RAW.lrtemplate', userDir, bundledDir: BUNDLED });
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /keine eigene Vorgabe/);
  assert.ok(fs.existsSync(path.join(BUNDLED, 'RAW.lrtemplate')), 'die Auslieferung bleibt unangetastet');
});

test('das Abwählen überlebt einen Neustart', (t) => {
  const userDir = userDirFuer(t);
  assert.equal(setPresetAktiv({ datei: 'RAW.lrtemplate', aktiv: false, userDir }).ok, true);

  const nachher = listPresets({ bundledDir: BUNDLED, userDir });
  assert.equal(nachher.find((v) => v.datei === 'RAW.lrtemplate').aktiv, false);
  assert.equal(nachher.filter((v) => v.aktiv).length, 4);

  setPresetAktiv({ datei: 'RAW.lrtemplate', aktiv: true, userDir });
  assert.equal(
    listPresets({ bundledDir: BUNDLED, userDir }).find((v) => v.datei === 'RAW.lrtemplate').aktiv,
    true,
  );
});

test('Bezeichnung und Kurzform einer Exportvorgabe lassen sich ändern', (t) => {
  const userDir = userDirFuer(t);
  importPreset({ quellPfad: tempDatei(t, 'Web_Klein.lrtemplate', 's = {}'), userDir, bundledDir: BUNDLED });

  assert.equal(setPresetMeta({ datei: 'Web_Klein.lrtemplate', lang: 'Web (klein)', kurz: 'WEB', userDir }).ok, true);
  const eintrag = listPresets({ bundledDir: BUNDLED, userDir }).find((v) => v.datei === 'Web_Klein.lrtemplate');
  assert.equal(eintrag.lang, 'Web (klein)');
  assert.equal(eintrag.kurz, 'WEB');
});

test('Angaben lassen sich nur bei Exportvorgaben setzen', (t) => {
  const userDir = userDirFuer(t);
  const ergebnis = setPresetMeta({ datei: 'SOLA_Draussen.xmp', lang: 'x', kurz: 'y', userDir });
  assert.equal(ergebnis.ok, false);
});

test('eine unbekannte Dateiendung wird abgewiesen', (t) => {
  const userDir = userDirFuer(t);
  const ergebnis = importPreset({ quellPfad: tempDatei(t, 'notiz.txt'), userDir, bundledDir: BUNDLED });
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /Unbekannter Dateityp/);
  assert.equal(listPresets({ bundledDir: BUNDLED, userDir }).length, 5);
});

test('Zurücksetzen verwirft eigene Vorgaben und Abwahlen', (t) => {
  const userDir = userDirFuer(t);
  importPreset({ quellPfad: tempDatei(t, 'Extra.xmp'), userDir, bundledDir: BUNDLED });
  setPresetAktiv({ datei: 'RAW.lrtemplate', aktiv: false, userDir });
  assert.equal(listPresets({ bundledDir: BUNDLED, userDir }).length, 6);

  assert.equal(resetPresets({ userDir }).ok, true);
  const liste = listPresets({ bundledDir: BUNDLED, userDir });
  assert.equal(liste.length, 5);
  assert.ok(liste.every((v) => v.quelle === 'mitgeliefert' && v.aktiv));
});

test('das Wiedereinlesen hebt eine frühere Abwahl auf', (t) => {
  const userDir = userDirFuer(t);
  setPresetAktiv({ datei: 'SOLA_Draussen.xmp', aktiv: false, userDir });
  importPreset({ quellPfad: tempDatei(t, 'SOLA_Draussen.xmp', 'NEU'), userDir, bundledDir: BUNDLED });

  const eintrag = listPresets({ bundledDir: BUNDLED, userDir }).find((v) => v.datei === 'SOLA_Draussen.xmp');
  assert.equal(eintrag.aktiv, true);
});

test('ein kaputtes Manifest legt die Liste nicht lahm', (t) => {
  const userDir = userDirFuer(t);
  fs.writeFileSync(path.join(userDir, 'manifest.json'), '{ kein json');
  const liste = listPresets({ bundledDir: BUNDLED, userDir });
  assert.equal(liste.length, 5);
  assert.ok(liste.every((v) => v.aktiv));
});

test('Angaben werden aus dem Dateinamen abgeleitet', () => {
  assert.deepEqual(metaAusDateiname('Meine_Vorgabe_XY.lrtemplate'), { lang: 'Meine Vorgabe XY', kurz: 'XY' });
  assert.equal(typVonDatei('a.LRTEMPLATE'), 'export');
  assert.equal(typVonDatei('a.XMP'), 'develop');
  assert.equal(typVonDatei('a.txt'), null);
});
