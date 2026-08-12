'use strict';

/** Anzahl der Tage, die ein Sola dauert (Tag 1 bis Tag 8). */
const SOLA_TAGE = 8;

/**
 * Wandelt ein Datum in das im Projekt genutzte Format `dd-MM-yyyy`.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

/**
 * Liest ein Datum aus `yyyy-MM-dd` (Format des HTML `<input type="date">`).
 * Bewusst ohne `new Date(string)`, damit die Zeitzone das Datum nicht verschiebt.
 * @param {string} value
 * @returns {Date|null}
 */
function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

/** Gegenstück zu {@link parseIsoDate}. */
function toIsoDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Berechnet die Datumsstrings für alle Solatage ab dem Startdatum.
 * @param {string|Date} start Startdatum (ISO-String oder Date)
 * @param {number} [tage]
 * @returns {string[]} z.B. ['13-06-2022', '14-06-2022', ...]
 */
function berechneWoche(start, tage = SOLA_TAGE) {
  const startDate = start instanceof Date ? start : parseIsoDate(start);
  if (!startDate) return [];
  const result = [];
  for (let i = 0; i < tage; i += 1) {
    const tag = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    result.push(formatDate(tag));
  }
  return result;
}

/**
 * Ermittelt das Solajahr aus den angewählten Startdaten.
 * Weichen Teens und Kids voneinander ab, wird `conflict` gesetzt – die
 * Oberfläche fragt dann nach einer manuellen Eingabe.
 * @param {{teens?: boolean, kids?: boolean, teenStart?: string, kidsStart?: string}} config
 * @returns {{jahr: string, conflict: boolean, teenJahr: string, kidsJahr: string}}
 */
function solaJahr(config) {
  const teenDate = config.teens ? parseIsoDate(config.teenStart) : null;
  const kidsDate = config.kids ? parseIsoDate(config.kidsStart) : null;
  const teenJahr = teenDate ? String(teenDate.getFullYear()) : '';
  const kidsJahr = kidsDate ? String(kidsDate.getFullYear()) : '';

  if (teenJahr && kidsJahr) {
    return { jahr: teenJahr === kidsJahr ? teenJahr : '', conflict: teenJahr !== kidsJahr, teenJahr, kidsJahr };
  }
  return { jahr: teenJahr || kidsJahr, conflict: false, teenJahr, kidsJahr };
}

module.exports = { SOLA_TAGE, formatDate, parseIsoDate, toIsoDate, berechneWoche, solaJahr };
