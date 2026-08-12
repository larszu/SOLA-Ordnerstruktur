'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const { buildPlan, BEREICHE, emptyConfig } = require('../core/structure');
const { createStructure } = require('../core/createStructure');
const { installPresets, lightroomPfade } = require('../core/lightroom');
const presetStore = require('../core/presetStore');
const { toCsv, toJson, parseConfig } = require('../core/config');

const IST_MAC = process.platform === 'darwin';

/**
 * Die Vorlagen liegen im gepackten Build unter `resources/`, im Entwicklungs-
 * betrieb im Projektordner.
 */
function presetsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'presets')
    : path.join(__dirname, '..', '..', 'resources', 'presets');
}

/**
 * Eigene Vorgaben liegen im Benutzerdatenordner und überleben damit ein
 * Update der App — anders als der mitgelieferte, schreibgeschützte Ordner.
 * Über SOLA_USER_PRESETS lässt sich der Pfad für Tests umbiegen.
 */
function userPresetsDir() {
  return process.env.SOLA_USER_PRESETS || path.join(app.getPath('userData'), 'presets');
}

const presetOrdner = () => ({ bundledDir: presetsDir(), userDir: userPresetsDir() });

/** @type {BrowserWindow|null} */
let fenster = null;

function createWindow() {
  fenster = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 600,
    minHeight: 560,
    title: 'SOLA Ordnerstruktur',
    backgroundColor: '#f4f5f7',
    // Auf macOS sitzt die Ampel im eigenen Header, unter Windows bleibt die
    // Systemleiste stehen.
    titleBarStyle: IST_MAC ? 'hiddenInset' : 'default',
    icon: process.platform === 'linux' ? path.join(__dirname, '..', '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Der Preload nutzt nur contextBridge und ipcRenderer – beides läuft im Sandbox-Modus.
      sandbox: true,
    },
  });

  fenster.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  fenster.on('closed', () => {
    fenster = null;
  });

  // Externe Links im Systembrowser öffnen, nicht in einem Electron-Fenster.
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(IST_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Konfiguration laden …',
          accelerator: 'CmdOrCtrl+O',
          click: () => fenster && fenster.webContents.send('menu:load'),
        },
        {
          label: 'Konfiguration speichern …',
          accelerator: 'CmdOrCtrl+S',
          click: () => fenster && fenster.webContents.send('menu:save'),
        },
        { type: 'separator' },
        IST_MAC ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Projekt auf GitHub',
          click: () => shell.openExternal('https://github.com/larszu/geklaute-ordnerstruktur-mac-'),
        },
        {
          label: 'Original für Windows (TH0RB3Nger)',
          click: () => shell.openExternal('https://github.com/TH0RB3Nger/SOLA_Ordnerstrucktur'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IST_MAC) app.quit();
});

// ---------------------------------------------------------------------------
// IPC – alles, was Datei- oder Dialogzugriff braucht, läuft hier im Hauptprozess.
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:ordnerWaehlen', async (_e, titel) => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: titel || 'Zielordner wählen',
    message: titel || 'Zielordner wählen',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Auswählen',
  });
  return ergebnis.canceled ? '' : ergebnis.filePaths[0];
});

ipcMain.handle('plan:vorschau', (_e, config) => buildPlan(config));

ipcMain.handle('struktur:erstellen', (_e, { zielPfad, config }) => createStructure(zielPfad, config));

ipcMain.handle('struktur:oeffnen', (_e, pfad) => {
  if (pfad && fs.existsSync(pfad)) shell.openPath(pfad);
});

ipcMain.handle('config:speichern', async (_e, config) => {
  const ergebnis = await dialog.showSaveDialog(fenster, {
    title: 'Konfiguration speichern unter',
    defaultPath: `Sola_Konfiguration_${config.jahr || new Date().getFullYear()}.json`,
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'CSV (Format des Windows-Originals)', extensions: ['csv'] },
    ],
  });
  if (ergebnis.canceled || !ergebnis.filePath) return { gespeichert: false };

  const pfad = ergebnis.filePath;
  const inhalt = /\.csv$/i.test(pfad) ? toCsv(config) : toJson(config);
  try {
    fs.writeFileSync(pfad, inhalt, 'utf8');
    return { gespeichert: true, pfad };
  } catch (err) {
    return { gespeichert: false, fehler: err.message };
  }
});

ipcMain.handle('config:laden', async () => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: 'Konfiguration wählen',
    properties: ['openFile'],
    filters: [
      { name: 'Konfiguration', extensions: ['json', 'csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'CSV', extensions: ['csv'] },
    ],
  });
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return { geladen: false };

  const pfad = ergebnis.filePaths[0];
  try {
    const text = fs.readFileSync(pfad, 'utf8');
    return { geladen: true, pfad, config: parseConfig(text, pfad) };
  } catch (err) {
    return { geladen: false, fehler: err.message };
  }
});

ipcMain.handle('lightroom:pfade', () => ({ ...lightroomPfade(), eigene: userPresetsDir() }));

ipcMain.handle('lightroom:installieren', (_e, { jahr, sola, kuerzel }) =>
  installPresets({ vorgaben: presetStore.listPresets(presetOrdner()), jahr, sola, kuerzel }),
);

// --- Verwaltung der Vorgaben ------------------------------------------------

ipcMain.handle('presets:liste', () => presetStore.listPresets(presetOrdner()));

ipcMain.handle('presets:hinzufuegen', async () => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: 'Lightroom-Vorgabe wählen',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Lightroom-Vorgaben', extensions: ['lrtemplate', 'xmp'] },
      { name: 'Exportvorgabe', extensions: ['lrtemplate'] },
      { name: 'Entwicklungsvorgabe', extensions: ['xmp'] },
    ],
  });
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return { abgebrochen: true };

  const ordner = presetOrdner();
  const ergebnisse = ergebnis.filePaths.map((quellPfad) => ({
    quelle: path.basename(quellPfad),
    ...presetStore.importPreset({ quellPfad, ...ordner }),
  }));
  return { abgebrochen: false, ergebnisse, vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:entfernen', (_e, datei) => {
  const ordner = presetOrdner();
  return { ...presetStore.removePreset({ datei, ...ordner }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:aktiv', (_e, { datei, aktiv }) => {
  const ordner = presetOrdner();
  return { ...presetStore.setPresetAktiv({ datei, aktiv, userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:meta', (_e, { datei, lang, kurz }) => {
  const ordner = presetOrdner();
  return { ...presetStore.setPresetMeta({ datei, lang, kurz, userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:zuruecksetzen', () => {
  const ordner = presetOrdner();
  return { ...presetStore.resetPresets({ userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('shell:oeffnen', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// Direkt aus der package.json statt über app.getVersion(): Letzteres liefert
// die Electron-Version, sobald die App nicht über ihr Projektverzeichnis
// gestartet wird (etwa im Smoke-Lauf).
const { version: APP_VERSION } = require('../../package.json');

ipcMain.handle('app:info', () => ({
  version: APP_VERSION,
  plattform: process.platform,
  // Bereichsliste und leere Konfiguration kommen aus dem Kern, damit die
  // Oberfläche keine zweite Quelle der Wahrheit aufmacht.
  bereiche: BEREICHE,
  leereConfig: emptyConfig(),
}));
