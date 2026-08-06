'use strict';

// Namen dürfen Buchstaben (inkl. Umlaute), Leerzeichen und - ' . enthalten.
// Gegenüber dem Windows-Original erweitert, damit "Müller" oder "Schön" durchgehen.
const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿẞß]+(?:[ '.-][A-Za-zÀ-ÖØ-öø-ÿẞß]+)*$/;

// Kürzel im Lightroom-Stil: ein bis zwei Buchstaben je Initiale, jeweils mit Punkt.
// Beispiele: "M.U.", "Th.R.", "L.Z."
const KUERZEL_PATTERN = /^(?:[A-Za-zÀ-ÖØ-öø-ÿ]{1,2}\.)+$/;

// Auf beiden Plattformen unzulässige bzw. problematische Zeichen in Ordnernamen.
// Windows verbietet < > : " / \ | ? *, macOS stolpert über / und :.
// eslint-disable-next-line no-control-regex
const UNSAFE_SEGMENT_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

// Reservierte Gerätenamen unter Windows – als Ordnername nicht verwendbar.
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** @param {string} value */
function isValidName(value) {
  const s = String(value || '').trim();
  return s.length > 0 && NAME_PATTERN.test(s);
}

/** @param {string} value */
function isValidKuerzel(value) {
  return KUERZEL_PATTERN.test(String(value || '').trim());
}

/**
 * Macht aus beliebigem Text einen Ordnernamen, der unter macOS *und* Windows
 * funktioniert. Wird auf jedes einzelne Pfadsegment angewendet.
 * @param {string} value
 * @returns {string}
 */
function sanitizeSegment(value) {
  let s = String(value == null ? '' : value)
    .replace(UNSAFE_SEGMENT_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows schneidet Punkte und Leerzeichen am Ende eines Namens still ab.
    .replace(/[. ]+$/g, '');

  if (WINDOWS_RESERVED.has(s.toUpperCase())) s = `${s}_`;
  // 255 Bytes sind auf HFS+/APFS und NTFS die übliche Obergrenze je Segment.
  if (Buffer.byteLength(s, 'utf8') > 200) {
    while (Buffer.byteLength(s, 'utf8') > 200) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
}

/**
 * Entfernt leere Einträge aus einer Namensliste und rückt die restlichen auf.
 * @param {Array<string>} names
 * @param {number} [length]
 * @returns {string[]}
 */
function compactNames(names, length = 10) {
  const filled = (names || []).map((n) => String(n || '').trim()).filter((n) => n.length > 0);
  while (filled.length < length) filled.push('');
  return filled.slice(0, length);
}

module.exports = {
  NAME_PATTERN,
  KUERZEL_PATTERN,
  isValidName,
  isValidKuerzel,
  sanitizeSegment,
  compactNames,
};
