'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sindGleich, vergleicheImport, runImport } = require('../src/core/importRun');
const { emptyConfig } = require('../src/core/structure');

function tempOrdner(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function schreibe(ordner, name, inhalt) {
  fs.mkdirSync(ordner, { recursive: true });
  const p = path.join(ordner, name);
  fs.writeFileSync(p, inhalt);
  return p;
}

function solaConfig() {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.fotografen[0] = 'Lars';
  return c;
}

const ktx = { solaKey: 'teens', bereich: 'foto', person: 'Lars' };

test('sindGleich: Größe entscheidet zuerst, Inhalt am strengsten', (t) => {
  const dir = tempOrdner(t, 'gleich-');
  const a = schreibe(dir, 'a.bin', 'HALLO'); // 5 Bytes
  const b = schreibe(dir, 'b.bin', 'HALLO'); // gleich
  const c = schreibe(dir, 'c.bin', 'WELT!'); // 5 Bytes, anderer Inhalt
  const d = schreibe(dir, 'd.bin', 'LÄNGER!!'); // andere Größe
  // gleiche Änderungszeit erzwingen, damit zeitgroesse vergleichbar ist
  const jetzt = new Date();
  for (const p of [a, b, c]) fs.utimesSync(p, jetzt, jetzt);

  assert.equal(sindGleich(a, b, 'groesse'), true);
  assert.equal(sindGleich(a, b, 'zeitgroesse'), true);
  assert.equal(sindGleich(a, b, 'inhalt'), true);

  assert.equal(sindGleich(a, d, 'groesse'), false, 'andere Größe ist nie gleich');

  assert.equal(sindGleich(a, c, 'groesse'), true, 'nur Größe: gleich');
  assert.equal(sindGleich(a, c, 'inhalt'), false, 'Inhalt: verschieden');
});

test('vergleicheImport kategorisiert neu / vorhanden / abweichend', async (t) => {
  const quelle = tempOrdner(t, 'vgl-quelle-');
  const ziel = tempOrdner(t, 'vgl-ziel-');
  schreibe(quelle, '20260613_101010_a.jpg', 'AAA');

  // 1) Ziel leer -> alles neu
  const v1 = await vergleicheImport({ quelle, zielBasis: ziel, schema: 'sola', ktx, config: solaConfig() });
  assert.equal(v1.kategorien.neu, 1);
  assert.equal(v1.kategorien.gleich, 0);
  assert.equal(v1.zielBekannt, true);

  // 2) Nach dem Kopieren -> vorhanden (Änderungszeit bleibt erhalten)
  await runImport({ plan: v1.plan, zielBasis: ziel });
  const v2 = await vergleicheImport({ quelle, zielBasis: ziel, schema: 'sola', ktx, config: solaConfig() });
  assert.equal(v2.kategorien.gleich, 1, 'dieselbe Karte erneut -> schon vorhanden');
  assert.equal(v2.kategorien.neu, 0);

  // 3) Zieldatei verfälschen (andere Größe) -> abweichend
  const zielDatei = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '05_Lars', '01_ImportRAW', '20260613_101010_a.jpg');
  fs.writeFileSync(zielDatei, 'GANZ ANDERER INHALT');
  const v3 = await vergleicheImport({ quelle, zielBasis: ziel, schema: 'sola', ktx, config: solaConfig() });
  assert.equal(v3.kategorien.anders, 1);
  assert.equal(v3.kategorien.gleich, 0);
});

test('ohne Zielordner bleibt der Vergleich ohne Kategorien, aber mit Fundzahl', async (t) => {
  const quelle = tempOrdner(t, 'vgl-ohneziel-');
  schreibe(quelle, '20260613_101010_a.jpg', 'AAA');
  const v = await vergleicheImport({ quelle, zielBasis: '', schema: 'sola', ktx, config: solaConfig() });
  assert.equal(v.zielBekannt, false);
  assert.equal(v.gefunden, 1);
  assert.equal(v.kategorien.neu + v.kategorien.gleich + v.kategorien.anders, 0);
});
