'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  lightroomPfade,
  patchExportPreset,
  installPresets,
  EXPORT_PRESETS,
  DEVELOP_PRESETS,
} = require('../src/core/lightroom');

const PRESETS_DIR = path.join(__dirname, '..', 'resources', 'presets');

test('die Lightroom-Pfade passen zur Plattform', () => {
  const win = lightroomPfade('win32', { APPDATA: 'C:\\Users\\lars\\AppData\\Roaming' });
  assert.equal(win.exportPresets, path.join('C:\\Users\\lars\\AppData\\Roaming', 'Adobe', 'Lightroom', 'Export Presets', 'User Presets'));
  assert.equal(win.developPresets, path.join('C:\\Users\\lars\\AppData\\Roaming', 'Adobe', 'Lightroom', 'Develop Presets'));

  const mac = lightroomPfade('darwin', {});
  assert.ok(mac.developPresets.includes(path.join('Library', 'Application Support', 'Adobe', 'Lightroom')));
});

test('alle mitgelieferten Vorlagen sind vorhanden', () => {
  for (const preset of EXPORT_PRESETS) {
    assert.ok(fs.existsSync(path.join(PRESETS_DIR, preset.datei)), preset.datei);
  }
  for (const datei of DEVELOP_PRESETS) {
    assert.ok(fs.existsSync(path.join(PRESETS_DIR, datei)), datei);
  }
});

test('die Exportvorgabe bekommt Jahr, Sola und Kürzel eingetragen', () => {
  const roh = fs.readFileSync(path.join(PRESETS_DIR, 'HighQuality_HQ.lrtemplate'), 'utf8');
  const { inhalt, fehlend } = patchExportPreset(roh, {
    jahr: '26',
    sola: 'Teens',
    kuerzel: 'L.Z.',
    lang: 'HighQuality (HQ)',
    kurz: 'HQ',
  });

  assert.deepEqual(fehlend, []);
  assert.match(inhalt, /\tinternalName = "SOLA26_Teens_HighQuality \(HQ\)",/);
  assert.match(inhalt, /\ttitle = "SOLA26_Teens_HighQuality \(HQ\)",/);
  assert.match(inhalt, /\t\ttokenCustomString = "L\.Z\.",/);
  assert.match(inhalt, /SOLA26_Teens_\{\{custom_token\}\}_HQ_\{\{image_name\}\}/);
});

test('tokensArchivedToString2 bleibt unangetastet', () => {
  const roh = fs.readFileSync(path.join(PRESETS_DIR, 'RAW.lrtemplate'), 'utf8');
  const { inhalt } = patchExportPreset(roh, {
    jahr: '26', sola: 'Kids', kuerzel: 'M.U.', lang: 'RAW', kurz: 'RAW',
  });
  const original = roh.split(/\r?\n/).find((z) => z.includes('tokensArchivedToString2'));
  assert.ok(original);
  assert.ok(inhalt.split(/\r?\n/).includes(original));
  // Genau eine Zeile trägt die neuen Tokens.
  assert.equal(inhalt.split(/\r?\n/).filter((z) => /(^|\s)tokens\s*=/.test(z)).length, 1);
});

test('fehlende Schlüssel werden gemeldet statt still ignoriert', () => {
  const { fehlend } = patchExportPreset('s = {\n\tid = "x",\n}\n', {
    jahr: '26', sola: 'Teens', kuerzel: 'L.Z.', lang: 'RAW', kurz: 'RAW',
  });
  assert.deepEqual(fehlend.sort(), ['internalName', 'title', 'tokenCustomString', 'tokens']);
});

test('installPresets schreibt alle fünf Dateien', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-lr-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const ziele = {
    developPresets: path.join(tmp, 'Develop Presets'),
    exportPresets: path.join(tmp, 'Export Presets', 'User Presets'),
  };
  const ergebnis = installPresets({ presetsDir: PRESETS_DIR, jahr: '26', sola: 'Kids', kuerzel: 'M.U.', ziele });

  assert.deepEqual(ergebnis.fehler, []);
  assert.equal(ergebnis.erfolg, true);
  assert.equal(ergebnis.installiert.length, EXPORT_PRESETS.length + DEVELOP_PRESETS.length);

  const hq = fs.readFileSync(path.join(ziele.exportPresets, 'HighQuality_HQ.lrtemplate'), 'utf8');
  assert.match(hq, /SOLA26_Kids_HighQuality/);
  assert.ok(fs.existsSync(path.join(ziele.developPresets, 'SOLA_Draussen.xmp')));
});

test('ein nicht beschreibbares Ziel führt zu Fehlern statt zu einem Absturz', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-lr-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Eine Datei dort, wo ein Ordner hin soll.
  fs.writeFileSync(path.join(tmp, 'blockiert'), 'x');

  const ziele = {
    developPresets: path.join(tmp, 'blockiert', 'Develop Presets'),
    exportPresets: path.join(tmp, 'blockiert', 'Export Presets'),
  };
  const ergebnis = installPresets({ presetsDir: PRESETS_DIR, jahr: '26', sola: 'Kids', kuerzel: 'M.U.', ziele });
  assert.equal(ergebnis.erfolg, false);
  assert.ok(ergebnis.fehler.length > 0);
});
