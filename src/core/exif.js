'use strict';

// Anbindung an ExifTool. Optional: fehlt das Programm, arbeitet die App
// trotzdem weiter – das Aufnahmedatum kommt dann aus Dateiname oder
// Änderungsdatum (siehe importPlan.js). ExifTool wird nur zum Lesen der
// Metadaten benutzt, es verändert keine Dateien.
const { execFile, execFileSync } = require('child_process');
const path = require('path');

const IST_WINDOWS = process.platform === 'win32';

/**
 * Sucht `exiftool` an den üblichen Stellen. Über SOLA_EXIFTOOL lässt sich ein
 * fester Pfad vorgeben (für Tests oder ein mitgeliefertes Binary).
 * @returns {string|null} aufrufbarer Pfad oder null
 */
function findeExiftool() {
  const kandidaten = [
    process.env.SOLA_EXIFTOOL,
    IST_WINDOWS ? 'exiftool.exe' : 'exiftool',
    '/opt/homebrew/bin/exiftool',
    '/usr/local/bin/exiftool',
    '/usr/bin/exiftool',
    '/opt/local/bin/exiftool',
  ].filter(Boolean);

  for (const kandidat of kandidaten) {
    try {
      execFileSync(kandidat, ['-ver'], { stdio: 'ignore', timeout: 5000 });
      return kandidat;
    } catch (_) {
      // nächsten Kandidaten versuchen
    }
  }
  return null;
}

const EXIFTOOL = findeExiftool();

/** Felder, die der Import ausliest. */
const FELDER = [
  'DateTimeOriginal', // Aufnahmezeitpunkt bei Fotos
  'CreateDate', // Ersatz, wenn DateTimeOriginal fehlt
  'MediaCreateDate', // Aufnahmezeitpunkt bei Videos
  'Model', // Kameramodell
  'SerialNumber', // Seriennummer (Kamera -> Person, später)
  'InternalSerialNumber',
];

/** Ein Pfad-Schlüssel, der auf beiden Plattformen zur ExifTool-Ausgabe passt. */
function schluessel(pfad) {
  return String(pfad).replace(/\\/g, '/');
}

/**
 * Liest die Metadaten vieler Dateien in einem einzigen ExifTool-Aufruf.
 * Die Pfade gehen über stdin (`-@ -`), nicht als Argumente – so greift auch
 * bei tausenden Dateien keine Kommandozeilen-Längenbeschränkung.
 *
 * @param {string[]} pfade absolute Dateipfade
 * @returns {Promise<Object<string, object>>} Map normalisierter Pfad -> Metadaten
 */
function leseMetadaten(pfade) {
  return new Promise((resolve) => {
    if (!EXIFTOOL || !pfade || pfade.length === 0) return resolve({});
    const args = [
      '-q', '-m', '-fast2',
      '-charset', 'filename=utf8', // Umlaute in Pfaden (z.B. 05_Jürgen) unter Windows
      '-api', 'QuickTimeUTC', // QuickTime-Zeiten stehen in UTC -> lokale Zeit
      '-d', '%Y-%m-%d %H:%M:%S',
      '-json',
      ...FELDER.map((f) => `-${f}`),
      '-@', '-',
    ];
    const kind = execFile(EXIFTOOL, args, { maxBuffer: 1 << 28 }, (_err, stdout) => {
      const daten = {};
      try {
        for (const eintrag of JSON.parse(stdout || '[]')) {
          daten[schluessel(eintrag.SourceFile)] = eintrag;
        }
      } catch (_) {
        // Unlesbare Ausgabe -> leere Map, der Aufrufer fällt auf Name/mtime zurück.
      }
      resolve(daten);
    });
    kind.on('error', () => resolve({}));
    kind.stdin.on('error', () => {});
    kind.stdin.write(pfade.map((p) => path.resolve(p)).join('\n'));
    kind.stdin.end();
  });
}

module.exports = {
  EXIFTOOL,
  vorhanden: Boolean(EXIFTOOL),
  FELDER,
  schluessel,
  leseMetadaten,
};
