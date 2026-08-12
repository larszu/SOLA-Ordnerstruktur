'use strict';

const { BEREICHE, SOLAS, emptyConfig, normalizeConfig } = require('./structure');
const { parseIsoDate, toIsoDate, SOLA_TAGE } = require('./dates');

const DL = ';';

/** Die beiden Solas, die im CSV-Format des Originals vorkommen. */
const CSV_SOLAS = ['teens', 'kids'];

/**
 * Spaltenreihenfolge der CSV – identisch zum Windows-Original (Alpha-v0.2.x).
 *
 * Das Format kennt nur Teens und Kids und geht von acht Tagen aus. Es bleibt
 * erhalten, damit alte Dateien weiter gelesen werden können; alles darüber
 * hinaus (SOFA, Sola next, abweichende Dauer) passt nur ins JSON-Format.
 * {@link csvVerlust} sagt vorab, was beim Speichern als CSV wegfiele.
 */
const CSV_HEADER = [
  'SolaJahr',
  'Teens',
  'Kids',
  ...Array.from({ length: 10 }, (_, i) => `NameTeenFotograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameTeenVideograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameKidsFotograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameKidsVideograf${i + 1}`),
  ...BEREICHE.map((b) => `AuswahlTeen${b.label}`),
  ...BEREICHE.map((b) => `AuswahlKids${b.label}`),
  'TeenStartDatum',
  'KidsStartDatum',
];

/**
 * Liest ein Datum in einem der Formate, die in den alten CSV-Dateien vorkommen:
 * `dd-MM-yyyy`, `dd.MM.yyyy`, `MM/dd/yyyy` oder ISO `yyyy-MM-dd`.
 * @param {string} value
 * @returns {string} ISO-Datum `yyyy-MM-dd` oder Leerstring
 */
function parseFlexibleDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';

  const iso = parseIsoDate(s);
  if (iso) return toIsoDate(iso);

  // Datumsanteil vor einer eventuellen Uhrzeit abtrennen ("13-06-2022 00:00:00").
  const datumsteil = s.split(/[ T]/)[0];

  let m = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(datumsteil);
  if (m) return bauen(m[3], m[2], m[1]);

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datumsteil);
  // US-Schreibweise: Monat zuerst.
  if (m) return bauen(m[3], m[1], m[2]);

  return '';

  function bauen(jahr, monat, tag) {
    const d = new Date(Number(jahr), Number(monat) - 1, Number(tag));
    return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
  }
}

const toBool = (v) => /^(true|wahr|ja|yes|1|-1)$/i.test(String(v || '').trim());
const fromBool = (v) => (v ? 'True' : 'False');

/** Feld für die CSV maskieren, falls es Trennzeichen oder Anführungszeichen enthält. */
function csvFeld(value) {
  const s = String(value == null ? '' : value);
  return /["\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Eine CSV-Zeile in Felder zerlegen (mit Unterstützung für "…"-Maskierung). */
function csvZeile(zeile) {
  const felder = [];
  let feld = '';
  let inQuotes = false;
  for (let i = 0; i < zeile.length; i += 1) {
    const c = zeile[i];
    if (inQuotes) {
      if (c === '"') {
        if (zeile[i + 1] === '"') {
          feld += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        feld += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === DL) {
      felder.push(feld);
      feld = '';
    } else {
      feld += c;
    }
  }
  felder.push(feld);
  return felder;
}

/**
 * Serialisiert die Konfiguration im CSV-Format des Windows-Originals.
 * @param {import('./structure').Config} config
 * @returns {string}
 */
function toCsv(config) {
  const c = normalizeConfig(config);
  const datum = (iso) => {
    const d = parseIsoDate(iso);
    if (!d) return '';
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  };

  const werte = [
    c.jahr,
    fromBool(c.teens.aktiv),
    fromBool(c.kids.aktiv),
    ...c.teens.fotografen,
    ...c.teens.videografen,
    ...c.kids.fotografen,
    ...c.kids.videografen,
    ...BEREICHE.map((b) => fromBool(c.teens.bereiche[b.key])),
    ...BEREICHE.map((b) => fromBool(c.kids.bereiche[b.key])),
    datum(c.teens.start),
    datum(c.kids.start),
  ];

  return `${CSV_HEADER.join(DL)}\r\n${werte.map(csvFeld).join(DL)}\r\n`;
}

/**
 * Liest eine CSV-Konfiguration – sowohl die dieser App als auch die des
 * Windows-Originals.
 * @param {string} text
 * @returns {import('./structure').Config}
 */
function fromCsv(text) {
  const zeilen = String(text || '')
    .split(/\r?\n/)
    .filter((z) => z.trim().length > 0);
  if (zeilen.length < 2) throw new Error('Die CSV-Datei enthält keine Konfigurationszeile.');

  const felder = csvZeile(zeilen[1]);
  if (felder.length < CSV_HEADER.length) {
    throw new Error(`Unerwartetes CSV-Format: ${felder.length} statt ${CSV_HEADER.length} Spalten.`);
  }

  const config = emptyConfig();
  config.jahr = String(felder[0] || '').trim();
  config.teens.aktiv = toBool(felder[1]);
  config.kids.aktiv = toBool(felder[2]);

  const namen = (offset) => Array.from({ length: 10 }, (_, i) => String(felder[offset + i] || '').trim());
  config.teens.fotografen = namen(3);
  config.teens.videografen = namen(13);
  config.kids.fotografen = namen(23);
  config.kids.videografen = namen(33);

  BEREICHE.forEach((b, i) => {
    config.teens.bereiche[b.key] = toBool(felder[43 + i]);
    config.kids.bereiche[b.key] = toBool(felder[51 + i]);
  });

  config.teens.start = parseFlexibleDate(felder[59]);
  config.kids.start = parseFlexibleDate(felder[60]);

  return normalizeConfig(config);
}

/**
 * Nennt alles, was das CSV-Format des Originals nicht abbilden kann.
 * @param {import('./structure').Config} config
 * @returns {string[]} leer, wenn die CSV verlustfrei wäre
 */
function csvVerlust(config) {
  const c = normalizeConfig(config);
  const verlust = [];

  for (const sola of SOLAS) {
    const daten = c[sola.key];
    if (!daten.aktiv) continue;
    if (!CSV_SOLAS.includes(sola.key)) {
      verlust.push(`${sola.titel} (im CSV-Format nicht vorgesehen)`);
    } else if (daten.tage !== SOLA_TAGE) {
      verlust.push(`Dauer von ${sola.titel} (${daten.tage} statt ${SOLA_TAGE} Tage)`);
    }
  }
  return verlust;
}

/** JSON-Fassung – das bevorzugte Format dieser App. */
function toJson(config) {
  return `${JSON.stringify({ version: 1, ...normalizeConfig(config) }, null, 2)}\n`;
}

/** @returns {import('./structure').Config} */
function fromJson(text) {
  const daten = JSON.parse(text);
  return normalizeConfig(daten);
}

/** Wählt anhand der Dateiendung bzw. des Inhalts das passende Format. */
function parseConfig(text, dateiname = '') {
  if (/\.json$/i.test(dateiname) || String(text).trim().startsWith('{')) return fromJson(text);
  return fromCsv(text);
}

module.exports = { CSV_HEADER, CSV_SOLAS, toCsv, fromCsv, toJson, fromJson, parseConfig, parseFlexibleDate, csvVerlust };
