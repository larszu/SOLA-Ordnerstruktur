'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Schmale, klar umrissene Brücke zwischen Oberfläche und Hauptprozess.
 * Die Oberfläche bekommt keinen direkten Node-Zugriff.
 */
contextBridge.exposeInMainWorld('sola', {
  ordnerWaehlen: (titel) => ipcRenderer.invoke('dialog:ordnerWaehlen', titel),
  vorschau: (config) => ipcRenderer.invoke('plan:vorschau', config),
  strukturErstellen: (zielPfad, config) => ipcRenderer.invoke('struktur:erstellen', { zielPfad, config }),
  ordnerOeffnen: (pfad) => ipcRenderer.invoke('struktur:oeffnen', pfad),
  configSpeichern: (config) => ipcRenderer.invoke('config:speichern', config),
  configLaden: () => ipcRenderer.invoke('config:laden'),
  lightroomPfade: () => ipcRenderer.invoke('lightroom:pfade'),
  presetsInstallieren: (daten) => ipcRenderer.invoke('lightroom:installieren', daten),
  presetsListe: () => ipcRenderer.invoke('presets:liste'),
  presetHinzufuegen: () => ipcRenderer.invoke('presets:hinzufuegen'),
  presetEntfernen: (datei) => ipcRenderer.invoke('presets:entfernen', datei),
  presetAktiv: (datei, aktiv) => ipcRenderer.invoke('presets:aktiv', { datei, aktiv }),
  presetMeta: (datei, lang, kurz) => ipcRenderer.invoke('presets:meta', { datei, lang, kurz }),
  presetsZuruecksetzen: () => ipcRenderer.invoke('presets:zuruecksetzen'),
  linkOeffnen: (url) => ipcRenderer.invoke('shell:oeffnen', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  // Importfenster
  importFensterOeffnen: (kontext) => ipcRenderer.invoke('import:fensterOeffnen', kontext),
  importKontext: () => ipcRenderer.invoke('import:kontext'),
  geraeteListe: () => ipcRenderer.invoke('geraete:liste'),
  importVergleichen: (daten) => ipcRenderer.invoke('import:vergleichen', daten),
  importKopieren: (daten) => ipcRenderer.invoke('import:kopieren', daten),
  aufImportFortschritt: (handler) => ipcRenderer.on('import:fortschritt', (_e, d) => handler(d)),
  onMenu: (kanal, handler) => {
    const erlaubt = ['menu:load', 'menu:save', 'menu:import'];
    if (!erlaubt.includes(kanal)) return;
    ipcRenderer.on(kanal, () => handler());
  },
});
