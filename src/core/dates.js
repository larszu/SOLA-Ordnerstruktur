'use strict';

/** Voreingestellte Dauer eines Solas in Tagen. */
const SOLA_TAGE = 8;

/** Sinnvolle Grenzen für die einstellbare Dauer. */
const MIN_TAGE = 1;
const MAX_TAGE = 31;

/** Begrenzt eine eingegebene Tagesanzahl auf den zulässigen Bereich. */
function normalisiereTage(wert, standard = SOLA_TAGE) {
  const zahl = Math.round(Number(wert));
  if (!Number.isFinite(zahl) || zahl <= 0) return standard;
  return Math.min(MAX_TAGE, Math.max(MIN_TAGE, zahl));
}

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
 * Ermittelt das Solajahr aus den Startdaten der angewählten Solas.
 * Liegen sie in verschiedenen Jahren, wird `conflict` gesetzt und `jahre`
 * listet die Beteiligten – die Oberfläche fragt dann nach einer manuellen
 * Eingabe und kann benennen, welche Solas auseinanderfallen.
 *
 * @param {Array<{label: string, start: string}>} solas Nur die angewählten
 * @returns {{jahr: string, conflict: boolean, jahre: Array<{label: string, jahr: string}>}}
 */
function solaJahr(solas) {
  const jahre = (solas || [])
    .map((s) => {
      const datum = parseIsoDate(s.start);
      return { label: s.label, jahr: datum ? String(datum.getFullYear()) : '' };
    })
    .filter((e) => e.jahr);

  if (jahre.length === 0) return { jahr: '', conflict: false, jahre };

  const verschieden = new Set(jahre.map((e) => e.jahr));
  return {
    jahr: verschieden.size === 1 ? jahre[0].jahr : '',
    conflict: verschieden.size > 1,
    jahre,
  };
}

module.exports = {
  SOLA_TAGE,
  MIN_TAGE,
  MAX_TAGE,
  normalisiereTage,
  formatDate,
  parseIsoDate,
  toIsoDate,
  berechneWoche,
  solaJahr,
};
