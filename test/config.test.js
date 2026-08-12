'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toCsv, fromCsv, toJson, fromJson, parseConfig, parseFlexibleDate, CSV_HEADER } = require('../src/core/config');
const { emptyConfig } = require('../src/core/structure');

function beispiel() {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.bereiche.orga = true;
  c.teens.fotografen[0] = 'Lars';
  c.teens.videografen[0] = 'Maja';
  c.kids.aktiv = true;
  c.kids.start = '2026-08-01';
  c.kids.bereiche.video = true;
  c.kids.videografen[0] = 'Jonas';
  return c;
}

test('CSV überlebt einen Speichern-Laden-Umlauf', () => {
  const original = beispiel();
  const zurueck = fromCsv(toCsv(original));
  assert.deepEqual(zurueck, original);
});

test('JSON überlebt einen Speichern-Laden-Umlauf', () => {
  const original = beispiel();
  assert.deepEqual(fromJson(toJson(original)), original);
});

test('die CSV-Spalten entsprechen dem Windows-Original', () => {
  assert.equal(CSV_HEADER.length, 61);
  assert.equal(CSV_HEADER[0], 'SolaJahr');
  assert.equal(CSV_HEADER[3], 'NameTeenFotograf1');
  assert.equal(CSV_HEADER[43], 'AuswahlTeenFoto');
  assert.equal(CSV_HEADER[51], 'AuswahlKidsFoto');
  assert.equal(CSV_HEADER[59], 'TeenStartDatum');
  assert.equal(CSV_HEADER[60], 'KidsStartDatum');
});

test('eine CSV aus dem Windows-Original wird gelesen', () => {
  // Nachgestellte Zeile, wie das VB-Programm sie schreibt: True/False, dd-MM-yyyy.
  const werte = [
    '2022',
    'True',
    'False',
    'Lars', ...Array(9).fill(''),
    'Maja', ...Array(9).fill(''),
    ...Array(10).fill(''),
    ...Array(10).fill(''),
    'True', 'True', 'False', 'False', 'False', 'False', 'True', 'False',
    ...Array(8).fill('False'),
    '13-06-2022',
    '',
  ];
  const csv = `${CSV_HEADER.join(';')}\r\n${werte.join(';')}\r\n`;

  const config = fromCsv(csv);
  assert.equal(config.jahr, '2022');
  assert.equal(config.teens.aktiv, true);
  assert.equal(config.kids.aktiv, false);
  assert.equal(config.teens.start, '2022-06-13');
  assert.equal(config.teens.fotografen[0], 'Lars');
  assert.equal(config.teens.videografen[0], 'Maja');
  assert.deepEqual(
    Object.entries(config.teens.bereiche).filter(([, an]) => an).map(([k]) => k),
    ['foto', 'video', 'orga'],
  );
});

test('Datumsangaben werden in mehreren Schreibweisen erkannt', () => {
  assert.equal(parseFlexibleDate('13-06-2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('13.06.2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('2022-06-13'), '2022-06-13');
  assert.equal(parseFlexibleDate('06/13/2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('13-06-2022 00:00:00'), '2022-06-13');
  assert.equal(parseFlexibleDate(''), '');
  assert.equal(parseFlexibleDate('Unsinn'), '');
});

test('Namen mit Semikolon zerlegen die CSV nicht', () => {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.fotografen[0] = 'Meier; Lars';
  assert.equal(fromCsv(toCsv(c)).teens.fotografen[0], 'Meier; Lars');
});

test('parseConfig erkennt das Format', () => {
  const c = beispiel();
  assert.deepEqual(parseConfig(toJson(c), 'x.json'), c);
  assert.deepEqual(parseConfig(toCsv(c), 'x.csv'), c);
  // Ohne Dateiname entscheidet der Inhalt.
  assert.deepEqual(parseConfig(toJson(c)), c);
});

test('kaputte Dateien melden einen Fehler', () => {
  assert.throws(() => fromCsv('nur eine Kopfzeile'), /Konfigurationszeile/);
  assert.throws(() => fromCsv('a;b\r\n1;2\r\n'), /Spalten/);
});
