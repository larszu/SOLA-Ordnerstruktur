'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportPlan,
  bestimmeDatum,
  datumAusName,
  schemaListe,
  umbenannt,
} = require('../src/core/importPlan');
const { buildPlan, emptyConfig } = require('../src/core/structure');

function solaConfig({ fotografen = ['Lars'], videografen = [] } = {}) {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.bereiche.video = true;
  fotografen.forEach((n, i) => { c.teens.fotografen[i] = n; });
  videografen.forEach((n, i) => { c.teens.videografen[i] = n; });
  return c;
}

/** Baut eine Dateiinfo mit optionalem EXIF-Aufnahmedatum. */
function datei(pfad, aufnahme, extra = {}) {
  const name = pfad.split('/').pop();
  return { pfad, name, exif: aufnahme ? { DateTimeOriginal: aufnahme } : null, mtime: null, ...extra };
}

test('Datumskaskade bevorzugt EXIF vor Name vor Änderungsdatum', () => {
  const mitExif = bestimmeDatum({ name: '20200101_000000.jpg', exif: { DateTimeOriginal: '2026-06-13 14:30:12' }, mtime: new Date(2019, 0, 1) });
  assert.equal(mitExif.quelle, 'exif');
  assert.equal(mitExif.datum, '13-06-2026');

  const ausName = bestimmeDatum({ name: '20260615_100000_foto.jpg', exif: null, mtime: new Date(2019, 0, 1) });
  assert.equal(ausName.quelle, 'name');
  assert.equal(ausName.datum, '15-06-2026');

  const ausMtime = bestimmeDatum({ name: 'IMG_0001.jpg', exif: null, mtime: new Date(2026, 5, 17, 8, 0, 0) });
  assert.equal(ausMtime.quelle, 'mtime');
  assert.equal(ausMtime.datum, '17-06-2026');

  assert.equal(bestimmeDatum({ name: 'ohne.jpg', exif: null, mtime: null }), null);
});

test('datumAusName erkennt getrennte und zusammenhängende Schreibweisen', () => {
  assert.equal(datumAusName('2026-06-13 14.30.12.jpg').datum, '13-06-2026');
  assert.equal(datumAusName('IMG_20260613_143012.jpg').hh, '14');
  assert.equal(datumAusName('foto.jpg'), null);
});

test('Sola-Schema sortiert Fotos in ImportRAW und überspringt Tage außerhalb', () => {
  const config = solaConfig();
  const dateien = [
    datei('/k/a.cr3', '2026-06-13 09:00:00'), // Tag 1
    datei('/k/b.cr3', '2026-06-15 09:00:00'), // Tag 3
    datei('/k/c.cr3', '2026-05-01 09:00:00'), // außerhalb der Sola-Woche
  ];
  const { plan, uebersprungen, zusammenfassung } = buildImportPlan({
    dateien, schema: 'sola', ktx: { solaKey: 'teens', bereich: 'foto', person: 'Lars' }, config,
  });

  assert.equal(plan.length, 2);
  assert.equal(uebersprungen.length, 1);
  assert.match(uebersprungen[0].grund, /außerhalb/);
  assert.equal(zusammenfassung.quellen.exif, 2);

  assert.equal(plan[0].zielRel, 'Sola_2026/01_Teens/01_Foto/1_Tag_13-06-2026/05_Lars/01_ImportRAW');
  assert.equal(plan[1].zielRel, 'Sola_2026/01_Teens/01_Foto/3_Tag_15-06-2026/05_Lars/01_ImportRAW');
});

test('jeder Sola-Zielordner ist auch ein Ordner, den buildPlan anlegt', () => {
  const config = solaConfig({ fotografen: ['Lars', 'Maja'], videografen: ['Ben'] });
  const { ordner } = buildPlan(config);
  const alleOrdner = new Set(ordner);

  for (const [bereich, person] of [['foto', 'Maja'], ['video', 'Ben']]) {
    const dateien = [datei('/k/x.mp4', '2026-06-14 10:00:00')]; // Tag 2
    const { plan } = buildImportPlan({ dateien, schema: 'sola', ktx: { solaKey: 'teens', bereich, person }, config });
    assert.equal(plan.length, 1, `${bereich}/${person}`);
    assert.ok(alleOrdner.has(plan[0].zielRel), `${plan[0].zielRel} fehlt im Strukturbaum`);
  }
});

test('Video-Schema legt Personen unter 01_Rohvideos ab', () => {
  const config = solaConfig({ videografen: ['Ben'] });
  const { plan } = buildImportPlan({
    dateien: [datei('/k/v.mov', '2026-06-13 10:00:00')],
    schema: 'sola', ktx: { solaKey: 'teens', bereich: 'video', person: 'Ben' }, config,
  });
  assert.equal(plan[0].zielRel, 'Sola_2026/01_Teens/02_Video/1_Tag_13-06-2026/01_Rohvideos/01_Ben');
});

test('Sola-Schema meldet, wenn die Person nicht in der Liste steht', () => {
  const config = solaConfig({ fotografen: ['Lars'] });
  const { plan, warnungen } = buildImportPlan({
    dateien: [datei('/k/a.cr3', '2026-06-13 09:00:00')],
    schema: 'sola', ktx: { solaKey: 'teens', bereich: 'foto', person: 'Unbekannt' }, config,
  });
  assert.equal(plan.length, 0);
  assert.match(warnungen.join(' '), /Namensliste/);
});

test('Datumsbaum-Schema sortiert nach JJJJ/JJJJMM/JJJJMMDD und kann umbenennen', () => {
  const dateien = [datei('/k/IMG_1.jpg', '2026-06-13 14:30:12')];
  const roh = buildImportPlan({ dateien, schema: 'datum', ktx: {} });
  assert.equal(roh.plan[0].zielRel, '2026/202606/20260613');
  assert.equal(roh.plan[0].zielName, 'IMG_1.jpg');

  const benannt = buildImportPlan({ dateien, schema: 'datum', ktx: { umbenennen: true, unterordner: '_Handy' } });
  assert.equal(benannt.plan[0].zielRel, '_Handy/2026/202606/20260613');
  assert.equal(benannt.plan[0].zielName, '20260613_143012.jpg');
});

test('unbekanntes Schema liefert eine Warnung statt eines Plans', () => {
  const { plan, warnungen } = buildImportPlan({ dateien: [], schema: 'gibtsnicht' });
  assert.equal(plan.length, 0);
  assert.match(warnungen[0], /Unbekanntes Zielschema/);
});

test('schemaListe nennt beide Schemata ohne Funktionen', () => {
  const liste = schemaListe();
  assert.deepEqual(liste.map((s) => s.key).sort(), ['datum', 'sola']);
  for (const s of liste) assert.equal(typeof s.ziel, 'undefined');
});

test('umbenannt baut den Zeitstempelnamen', () => {
  assert.equal(umbenannt('IMG.CR3', { j: '2026', mo: '06', t: '13', hh: '14', mi: '30', ss: '12' }), '20260613_143012.cr3');
});
