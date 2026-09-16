'use strict';

// Erkennt angesteckte Wechseldatenträger (Kameras, Kartenleser, SD-Karten),
// damit man die Quelle im Importfenster mit einem Klick wählen kann, statt sie
// im Finder/Explorer zu suchen. Rein lesend; findet nichts Passendes, bleibt die
// Liste leer und man wählt den Ordner von Hand.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Ein DCIM-Ordner ist das sichere Zeichen für eine Kamera / SD-Karte. */
function hatDcim(wurzel) {
  try {
    return fs.readdirSync(wurzel).some((n) => n.toUpperCase() === 'DCIM');
  } catch (_) {
    return false;
  }
}

function eintrag(pfad, name) {
  return { pfad, name: name || path.basename(pfad), kamera: hatDcim(pfad) };
}

/** macOS: alles unter /Volumes außer dem Startvolume. */
function macGeraete() {
  const out = [];
  let bootReal = '/';
  try {
    bootReal = fs.realpathSync('/');
  } catch (_) {
    // egal – dann wird nichts ausgeschlossen
  }
  let namen = [];
  try {
    namen = fs.readdirSync('/Volumes');
  } catch (_) {
    return out;
  }
  for (const name of namen) {
    const pfad = path.join('/Volumes', name);
    try {
      if (fs.realpathSync(pfad) === bootReal) continue; // Startvolume überspringen
      if (!fs.statSync(pfad).isDirectory()) continue;
    } catch (_) {
      continue;
    }
    out.push(eintrag(pfad, name));
  }
  return out;
}

/** Windows: Laufwerke mit DriveType 2 (Wechseldatenträger). */
function winGeraete() {
  const out = [];
  let roh = '';
  try {
    roh = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object DeviceID,VolumeName | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
  } catch (_) {
    return out;
  }
  let daten;
  try {
    daten = JSON.parse(roh || 'null');
  } catch (_) {
    return out;
  }
  if (!daten) return out;
  for (const d of Array.isArray(daten) ? daten : [daten]) {
    const laufwerk = d.DeviceID ? `${d.DeviceID}\\` : '';
    if (!laufwerk) continue;
    out.push(eintrag(laufwerk, d.VolumeName ? `${d.VolumeName} (${d.DeviceID})` : d.DeviceID));
  }
  return out;
}

/** Linux: eingehängte Datenträger unter den üblichen Mount-Punkten. */
function linuxGeraete() {
  const out = [];
  const nutzer = process.env.USER || process.env.LOGNAME || '';
  const basen = [`/media/${nutzer}`, '/media', `/run/media/${nutzer}`, '/mnt'];
  const gesehen = new Set();
  for (const basis of basen) {
    let namen;
    try {
      namen = fs.readdirSync(basis);
    } catch (_) {
      continue;
    }
    for (const name of namen) {
      const pfad = path.join(basis, name);
      if (gesehen.has(pfad)) continue;
      try {
        if (!fs.statSync(pfad).isDirectory()) continue;
      } catch (_) {
        continue;
      }
      gesehen.add(pfad);
      out.push(eintrag(pfad, name));
    }
  }
  return out;
}

/**
 * Listet angesteckte Wechseldatenträger. Kameras / SD-Karten (mit DCIM) stehen
 * oben.
 * @returns {Array<{pfad: string, name: string, kamera: boolean}>}
 */
function listRemovable() {
  let liste = [];
  try {
    if (process.platform === 'darwin') liste = macGeraete();
    else if (process.platform === 'win32') liste = winGeraete();
    else liste = linuxGeraete();
  } catch (_) {
    liste = [];
  }
  return liste.sort((a, b) => (b.kamera - a.kamera) || a.name.localeCompare(b.name, 'de'));
}

module.exports = { listRemovable, hatDcim };
