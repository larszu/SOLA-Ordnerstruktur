'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanImport, runImport } = require('../src/core/importRun');
const { emptyConfig } = require('../src/core/structure');

// Die Tests kommen ohne ExifTool aus: die Fixture-Dateien tragen ihr
// Aufnahmedatum im Namen, sodass die Datumskaskade greift.
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

test('Sola-Import kopiert in die Struktur, ohne die Quelle anzutasten', async (t) => {
  const quelle = tempOrdner(t, 'sola-quelle-');
  const ziel = tempOrdner(t, 'sola-ziel-');
  const q1 = schreibe(quelle, '20260613_101010_a.jpg', 'AAA');
  schreibe(path.join(quelle, 'unterordner'), '20260615_120000_b.jpg', 'BBBB'); // Tag 3, rekursiv gefunden

  const scan = await scanImport({
    quelle, schema: 'sola', config: solaConfig(),
    ktx: { solaKey: 'teens', bereich: 'foto', person: 'Lars' },
  });
  assert.equal(scan.gefunden, 2);
  assert.equal(scan.plan.length, 2);

  const ergebnis = await runImport({ plan: scan.plan, zielBasis: ziel });
  assert.equal(ergebnis.erledigt, 2);
  assert.deepEqual(ergebnis.fehler, []);
  assert.equal(ergebnis.modus, 'kopiert');

  assert.ok(fs.existsSync(q1), 'Quelldatei bleibt erhalten (kopiert, nicht verschoben)');
  const tag1 = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '05_Lars', '01_ImportRAW', '20260613_101010_a.jpg');
  const tag3 = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '3_Tag_15-06-2026', '05_Lars', '01_ImportRAW', '20260615_120000_b.jpg');
  assert.ok(fs.existsSync(tag1), 'Tag 1 liegt im ImportRAW-Ordner');
  assert.ok(fs.existsSync(tag3), 'Tag 3 liegt im ImportRAW-Ordner');
  assert.ok(fs.existsSync(path.join(ziel, '_Import-Protokolle')), 'Protokollordner entsteht');
});

test('ein zweiter Lauf verdoppelt nichts', async (t) => {
  const quelle = tempOrdner(t, 'sola-quelle2-');
  const ziel = tempOrdner(t, 'sola-ziel2-');
  schreibe(quelle, '20260613_101010_a.jpg', 'AAA');

  const ktx = { solaKey: 'teens', bereich: 'foto', person: 'Lars' };
  const scan1 = await scanImport({ quelle, schema: 'sola', config: solaConfig(), ktx });
  const erst = await runImport({ plan: scan1.plan, zielBasis: ziel });
  assert.equal(erst.erledigt, 1);

  const scan2 = await scanImport({ quelle, schema: 'sola', config: solaConfig(), ktx });
  const zweit = await runImport({ plan: scan2.plan, zielBasis: ziel });
  assert.equal(zweit.erledigt, 0);
  assert.equal(zweit.uebersprungen, 1);

  const ordner = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '05_Lars', '01_ImportRAW');
  assert.deepEqual(fs.readdirSync(ordner), ['20260613_101010_a.jpg'], 'keine _1-Kopie entstanden');
});

test('Datumsbaum-Schema verschiebt bei ausdrücklichem Modus', async (t) => {
  const quelle = tempOrdner(t, 'datum-quelle-');
  const ziel = tempOrdner(t, 'datum-ziel-');
  const q = schreibe(quelle, '20260613_101010_a.jpg', 'AAA');

  const scan = await scanImport({ quelle, schema: 'datum', ktx: { umbenennen: true } });
  const ergebnis = await runImport({ plan: scan.plan, zielBasis: ziel, verschieben: true });

  assert.equal(ergebnis.erledigt, 1);
  assert.equal(ergebnis.modus, 'verschoben');
  assert.ok(!fs.existsSync(q), 'Quelldatei ist nach dem Verschieben weg');
  assert.ok(fs.existsSync(path.join(ziel, '2026', '202606', '20260613', '20260613_101010.jpg')));
});
