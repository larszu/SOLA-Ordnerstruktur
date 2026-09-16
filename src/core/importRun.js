'use strict';

// Der unreine Teil des Imports: Dateien sammeln, ihre Metadaten mit ExifTool
// lesen und den von importPlan berechneten Plan auf der Platte umsetzen.
//
// Sicherheitsprinzipien (wie beim Anlegen der Struktur):
//   - nichts wird überschrieben – bei Namensgleichheit wird durchnummeriert
//   - Standard ist KOPIEREN, nicht Verschieben (eine Speicherkarte bleibt heil)
//   - inhaltsgleiche Dateien (gleicher Name, gleiche Größe) werden übersprungen,
//     damit ein zweiter Lauf derselben Karte nichts verdoppelt
//   - jeder Lauf schreibt ein Protokoll in den Zielordner (_Import-Protokolle)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const exif = require('./exif');
const { buildImportPlan } = require('./importPlan');

const PROTOKOLL_ORDNER = '_Import-Protokolle';
const UEBERSPRINGEN_ORDNER = new Set([PROTOKOLL_ORDNER, '_LZ-Sortierer-Protokolle']);

const BILD = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.bmp', '.webp', '.dng', '.tif', '.tiff', '.arw', '.sr2', '.raf', '.cr2', '.cr3', '.nef', '.orf', '.rw2']);
const VIDEO = new Set(['.mp4', '.mov', '.3gp', '.mkv', '.m4v', '.avi', '.mts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.flv']);

/** 'bild' | 'video' | '' */
function art(name) {
  const e = path.extname(name).toLowerCase();
  if (BILD.has(e)) return 'bild';
  if (VIDEO.has(e)) return 'video';
  return '';
}

/** Läuft rekursiv durch `wurzel` und liefert alle Foto-/Videodateien. */
async function* medienUnter(wurzel) {
  let eintraege;
  try {
    eintraege = await fsp.readdir(wurzel, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of eintraege) {
    if (e.name.startsWith('.')) continue; // versteckte Dateien / .DS_Store
    const p = path.join(wurzel, e.name);
    if (e.isDirectory()) {
      if (UEBERSPRINGEN_ORDNER.has(e.name)) continue;
      yield* medienUnter(p);
    } else if (e.isFile() && art(e.name)) {
      yield p;
    }
  }
}

/** Sammelt alle Medien unter `quelle`. */
async function sammleMedien(quelle) {
  const out = [];
  for await (const p of medienUnter(quelle)) out.push(p);
  return out;
}

/** Liest zu jeder Datei Metadaten (falls ExifTool da ist) sowie das Änderungsdatum. */
async function leseInfos(dateien, melde) {
  const meta = {};
  if (exif.vorhanden) {
    const block = 1500;
    for (let i = 0; i < dateien.length; i += block) {
      Object.assign(meta, await exif.leseMetadaten(dateien.slice(i, i + block)));
      melde && melde(`Aufnahmedaten: ${Math.min(i + block, dateien.length)} / ${dateien.length}`);
    }
  }
  return dateien.map((p) => {
    let mtime = null;
    try {
      mtime = fs.statSync(p).mtime;
    } catch (_) {
      // bleibt null – dann greift Name oder es wird übersprungen
    }
    return {
      pfad: p,
      name: path.basename(p),
      exif: meta[exif.schluessel(path.resolve(p))] || meta[exif.schluessel(p)] || null,
      mtime,
      art: art(p),
    };
  });
}

/**
 * Trockenlauf: sammelt, liest Metadaten und berechnet den Plan – verändert nichts.
 * @returns {Promise<object>} Rückgabe von buildImportPlan, ergänzt um `gefunden`
 */
async function scanImport({ quelle, schema, ktx, config, melde }) {
  const dateien = await sammleMedien(quelle);
  melde && melde(
    `${dateien.length} Dateien gefunden` +
    (exif.vorhanden ? ', lese Aufnahmedaten …' : ' (ohne ExifTool – Datum aus Name/Änderungsdatum)'),
  );
  const infos = await leseInfos(dateien, melde);
  const ergebnis = buildImportPlan({ dateien: infos, schema, ktx, config });
  return { ...ergebnis, gefunden: dateien.length };
}

// ---- Ausführen --------------------------------------------------------------

async function freierName(ordner, name) {
  const ext = path.extname(name);
  const stamm = path.basename(name, ext);
  let ziel = path.join(ordner, name);
  let n = 1;
  while (fs.existsSync(ziel)) {
    ziel = path.join(ordner, `${stamm}_${n}${ext}`);
    n += 1;
  }
  return ziel;
}

function gleichGross(a, b) {
  try {
    return fs.statSync(a).size === fs.statSync(b).size;
  } catch (_) {
    return false;
  }
}

async function verschiebe(von, ziel) {
  await fsp.rename(von, ziel).catch(async (e) => {
    if (e.code === 'EXDEV') {
      await fsp.copyFile(von, ziel);
      await fsp.unlink(von);
    } else {
      throw e;
    }
  });
}

async function protokoll(zielBasis, zeilen) {
  const ordner = path.join(zielBasis, PROTOKOLL_ORDNER);
  await fsp.mkdir(ordner, { recursive: true });
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const datei = path.join(ordner, `import_${stempel}.txt`);
  await fsp.writeFile(datei, zeilen.join('\n'), 'utf8');
  return datei;
}

/**
 * Setzt den Plan um. Kopiert (Standard) oder verschiebt die Dateien in den
 * jeweiligen Zielordner unter `zielBasis`.
 *
 * @param {object} args
 * @param {object[]} args.plan       aus {@link scanImport}
 * @param {string}   args.zielBasis  Basisordner (bei Sola der gewählte Zielordner)
 * @param {boolean}  [args.verschieben=false]
 * @param {(text: string) => void} [args.melde]
 */
async function runImport({ plan, zielBasis, verschieben = false, melde }) {
  const modus = verschieben ? 'verschoben' : 'kopiert';
  const log = [
    `Import am ${new Date().toLocaleString('de-DE')}`,
    `Modus: ${verschieben ? 'verschoben' : 'kopiert'} · Zielbasis: ${zielBasis}`,
    '',
  ];
  let erledigt = 0;
  let uebersprungen = 0;
  const fehler = [];

  if (!zielBasis) {
    return { erledigt: 0, uebersprungen: 0, fehler: [{ von: '', grund: 'Kein Zielordner gewählt.' }], protokoll: '', modus };
  }

  for (const s of plan) {
    const zielOrdner = path.join(zielBasis, ...s.zielRel.split('/'));
    try {
      const direkt = path.join(zielOrdner, s.zielName);
      if (fs.existsSync(direkt) && gleichGross(s.von, direkt)) {
        uebersprungen += 1;
        log.push(`schon vorhanden: ${s.von}`);
      } else {
        await fsp.mkdir(zielOrdner, { recursive: true });
        const ziel = await freierName(zielOrdner, s.zielName);
        if (verschieben) await verschiebe(s.von, ziel);
        else await fsp.copyFile(s.von, ziel);
        // Änderungsdatum auf den Aufnahmezeitpunkt setzen (wie beim LZ-Sortierer).
        if (s.ts instanceof Date && !Number.isNaN(s.ts.getTime())) {
          try {
            await fsp.utimes(ziel, s.ts, s.ts);
          } catch (_) {
            // nicht kritisch
          }
        }
        log.push(`${s.von}  ->  ${ziel}`);
        erledigt += 1;
      }
    } catch (err) {
      fehler.push({ von: s.von, grund: err.message });
      log.push(`FEHLER ${s.von}: ${err.message}`);
    }
    if ((erledigt + uebersprungen) % 50 === 0) {
      melde && melde(`${modus}: ${erledigt} · übersprungen: ${uebersprungen} / ${plan.length}`);
    }
  }

  let protokollDatei = '';
  try {
    protokollDatei = await protokoll(zielBasis, log);
  } catch (err) {
    fehler.push({ von: PROTOKOLL_ORDNER, grund: `Protokoll nicht geschrieben: ${err.message}` });
  }

  return { erledigt, uebersprungen, fehler, protokoll: protokollDatei, modus };
}

module.exports = {
  BILD,
  VIDEO,
  art,
  sammleMedien,
  leseInfos,
  scanImport,
  runImport,
  freierName,
  PROTOKOLL_ORDNER,
};
