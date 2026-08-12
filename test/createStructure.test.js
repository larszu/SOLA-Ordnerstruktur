'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStructure } = require('../src/core/createStructure');
const { buildPlan, emptyConfig } = require('../src/core/structure');
const { isValidName, isValidKuerzel, sanitizeSegment, compactNames } = require('../src/core/validate');
const { berechneWoche, solaJahr, formatDate } = require('../src/core/dates');

function tempOrdner(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function beispielConfig() {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.bereiche.orga = true;
  c.teens.fotografen[0] = 'Lars';
  return c;
}

test('jeder geplante Ordner existiert danach wirklich', (t) => {
  const ziel = tempOrdner(t);
  const config = beispielConfig();

  const ergebnis = createStructure(ziel, config);
  assert.deepEqual(ergebnis.fehler, []);

  const { ordner } = buildPlan(config);
  assert.equal(ergebnis.erstellt, ordner.length);
  for (const relativ of ordner) {
    const absolut = path.join(ziel, ...relativ.split('/'));
    assert.ok(fs.statSync(absolut).isDirectory(), relativ);
  }
});

test('ein zweiter Lauf legt nichts doppelt an', (t) => {
  const ziel = tempOrdner(t);
  const config = beispielConfig();

  const erst = createStructure(ziel, config);
  const zweit = createStructure(ziel, config);

  assert.equal(zweit.erstellt, 0);
  assert.equal(zweit.vorhanden, erst.erstellt);
  assert.deepEqual(zweit.fehler, []);
});

test('nachträglich ergänzte Namen kommen dazu, ohne Bestehendes anzufassen', (t) => {
  const ziel = tempOrdner(t);
  const config = beispielConfig();
  createStructure(ziel, config);

  const markierung = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '05_Lars', 'foto.jpg');
  fs.writeFileSync(markierung, 'x');

  config.teens.fotografen[1] = 'Maja';
  const ergebnis = createStructure(ziel, config);

  assert.ok(ergebnis.erstellt > 0);
  assert.ok(fs.existsSync(markierung), 'vorhandene Datei bleibt erhalten');
  assert.ok(fs.existsSync(path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '06_Maja')));
});

test('ohne Zielordner passiert nichts', () => {
  const ergebnis = createStructure('', beispielConfig());
  assert.equal(ergebnis.erstellt, 0);
  assert.match(ergebnis.warnungen.join(' '), /Kein Zielordner/);
});

test('Namensprüfung lässt deutsche Namen zu und weist Unfug ab', () => {
  for (const ok of ['Lars', 'Müller', 'Anna-Lena', "O'Brien", 'Schön', 'Jean Luc']) {
    assert.ok(isValidName(ok), ok);
  }
  for (const nok of ['', '   ', 'Lars99', 'a/b', '<script>']) {
    assert.ok(!isValidName(nok), nok);
  }
});

test('Kürzelprüfung entspricht dem Original', () => {
  for (const ok of ['M.U.', 'L.Z.', 'Th.R.']) assert.ok(isValidKuerzel(ok), ok);
  for (const nok of ['MU', 'M.U', 'Max.', 'M..']) assert.ok(!isValidKuerzel(nok), nok);
});

test('sanitizeSegment entschärft plattformkritische Namen', () => {
  assert.equal(sanitizeSegment('A/B'), 'A_B');
  assert.equal(sanitizeSegment('C:Doppel'), 'C_Doppel');
  assert.equal(sanitizeSegment('Name.'), 'Name');
  assert.equal(sanitizeSegment('  Abstand  '), 'Abstand');
  assert.equal(sanitizeSegment('CON'), 'CON_');
  assert.equal(sanitizeSegment('LR Kataloge'), 'LR Kataloge');
  assert.ok(Buffer.byteLength(sanitizeSegment('ä'.repeat(300)), 'utf8') <= 200);
});

test('compactNames schließt Lücken und hält die Länge', () => {
  assert.deepEqual(compactNames(['', 'B', '', 'D'], 5), ['B', 'D', '', '', '']);
  assert.equal(compactNames([], 10).length, 10);
});

test('Datumsberechnung liefert acht aufeinanderfolgende Tage', () => {
  const tage = berechneWoche('2026-06-28');
  assert.equal(tage.length, 8);
  assert.equal(tage[0], '28-06-2026');
  // Monatswechsel muss stimmen.
  assert.equal(tage[3], '01-07-2026');
  assert.equal(tage[7], '05-07-2026');
});

test('Datumsberechnung überschreitet Jahres- und Schaltjahresgrenzen korrekt', () => {
  assert.equal(berechneWoche('2027-12-30')[7], '06-01-2028');
  assert.equal(berechneWoche('2028-02-26')[3], '29-02-2028');
  assert.deepEqual(berechneWoche('Unsinn'), []);
});

test('formatDate nutzt lokale Zeit, nicht UTC', () => {
  assert.equal(formatDate(new Date(2026, 0, 1)), '01-01-2026');
});

test('solaJahr meldet einen Konflikt', () => {
  assert.equal(solaJahr({ teens: true, teenStart: '2026-06-13' }).jahr, '2026');
  const konflikt = solaJahr({ teens: true, kids: true, teenStart: '2026-06-13', kidsStart: '2027-06-13' });
  assert.equal(konflikt.conflict, true);
  assert.equal(konflikt.jahr, '');
});
