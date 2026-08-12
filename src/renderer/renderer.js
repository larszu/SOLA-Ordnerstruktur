'use strict';

/* global sola */

const ANZAHL_NAMEN = 10;
// Bereiche mit Namensfeldern – nur bei diesen sind die Eingaben relevant.
const ROLLEN = { fotografen: 'foto', videografen: 'video' };

const zustand = {
  pfad: '',
  config: null,
  bereiche: [],
  letzterPlan: { ordner: [], jahr: '', warnungen: [] },
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

async function init() {
  const info = await sola.appInfo();
  zustand.bereiche = info.bereiche;
  zustand.config = info.leereConfig;
  $('version').textContent = `v${info.version}`;
  $('presetJahr').value = String(new Date().getFullYear()).slice(-2);

  baueSolas();
  verdrahteKopf();
  verdrahtePresets();
  await zeigeLightroomPfad();
  aktualisiere();
}

function baueSolas() {
  const ziel = $('solas');
  ziel.textContent = '';
  for (const [schluessel, titel] of [
    ['teens', 'Teensola (01_Teens)'],
    ['kids', 'Kidssola (02_Kids)'],
  ]) {
    ziel.appendChild(baueSola(schluessel, titel));
  }
}

function baueSola(schluessel, titel) {
  const knoten = $('solaVorlage').content.cloneNode(true);
  const artikel = knoten.querySelector('.sola');
  artikel.dataset.sola = schluessel;
  knoten.querySelector('.sola-titel').textContent = titel;

  const aktiv = knoten.querySelector('.sola-aktiv');
  aktiv.addEventListener('change', () => {
    zustand.config[schluessel].aktiv = aktiv.checked;
    aktualisiere();
  });

  const start = knoten.querySelector('.sola-start');
  start.addEventListener('change', () => {
    zustand.config[schluessel].start = start.value;
    aktualisiere();
  });

  const bereichsListe = knoten.querySelector('.bereiche-liste');
  for (const bereich of zustand.bereiche) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.bereich = bereich.key;
    box.addEventListener('change', () => {
      zustand.config[schluessel].bereiche[bereich.key] = box.checked;
      aktualisiere();
    });
    label.append(box, document.createTextNode(bereich.label));
    bereichsListe.appendChild(label);
  }

  for (const spalte of knoten.querySelectorAll('.namen-spalte')) {
    const rolle = spalte.dataset.rolle;
    const liste = spalte.querySelector('.namen-liste');
    for (let i = 0; i < ANZAHL_NAMEN; i += 1) {
      const feld = document.createElement('input');
      feld.type = 'text';
      feld.dataset.index = String(i);
      feld.placeholder = `${String(i + 1).padStart(2, '0')} · Name`;
      feld.addEventListener('input', () => {
        zustand.config[schluessel][rolle][i] = feld.value;
        feld.classList.toggle('ungueltig', feld.value.trim() !== '' && !nameOk(feld.value));
        aktualisiere({ ohneFelder: true });
      });
      // Beim Verlassen die Lücken schließen, wie im Original.
      feld.addEventListener('blur', () => {
        rueckeNamenAuf(schluessel, rolle);
        aktualisiere();
      });
      liste.appendChild(feld);
    }
  }

  return knoten;
}

function verdrahteKopf() {
  $('btnPfad').addEventListener('click', async () => {
    const pfad = await sola.ordnerWaehlen('Zielordner für die Ordnerstruktur wählen');
    if (pfad) {
      zustand.pfad = pfad;
      aktualisiere();
    }
  });

  $('jahr').addEventListener('input', () => {
    zustand.config.jahr = $('jahr').value.trim();
    aktualisiere({ ohneFelder: true });
  });

  $('btnVorschau').addEventListener('click', () => aktualisiere());
  $('btnErstellen').addEventListener('click', erstellen);
  $('btnSpeichern').addEventListener('click', speichern);
  $('btnLaden').addEventListener('click', laden);

  sola.onMenu('menu:save', speichern);
  sola.onMenu('menu:load', laden);

  for (const link of document.querySelectorAll('[data-link]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      sola.linkOeffnen(link.dataset.link);
    });
  }
}

// ---------------------------------------------------------------------------
// Aktualisierung
// ---------------------------------------------------------------------------

/** @param {{ohneFelder?: boolean}} [optionen] */
async function aktualisiere(optionen = {}) {
  $('pfadAnzeige').textContent = zustand.pfad || 'Noch kein Ordner gewählt';

  for (const artikel of document.querySelectorAll('.sola')) {
    const schluessel = artikel.dataset.sola;
    const daten = zustand.config[schluessel];
    artikel.dataset.aktiv = String(daten.aktiv);
    artikel.querySelector('.sola-aktiv').checked = daten.aktiv;

    if (!optionen.ohneFelder) {
      artikel.querySelector('.sola-start').value = daten.start || '';
      for (const box of artikel.querySelectorAll('[data-bereich]')) {
        box.checked = Boolean(daten.bereiche[box.dataset.bereich]);
      }
      for (const spalte of artikel.querySelectorAll('.namen-spalte')) {
        const rolle = spalte.dataset.rolle;
        for (const feld of spalte.querySelectorAll('input')) {
          const wert = daten[rolle][Number(feld.dataset.index)] || '';
          if (document.activeElement !== feld) feld.value = wert;
          feld.classList.toggle('ungueltig', wert.trim() !== '' && !nameOk(wert));
        }
      }
    }

    // Namensfelder nur freigeben, wenn der zugehörige Bereich angewählt ist.
    for (const spalte of artikel.querySelectorAll('.namen-spalte')) {
      const frei = daten.aktiv && Boolean(daten.bereiche[ROLLEN[spalte.dataset.rolle]]);
      spalte.dataset.frei = String(frei);
      for (const feld of spalte.querySelectorAll('input')) feld.disabled = !frei;
    }
  }

  if (!optionen.ohneFelder) $('jahr').value = zustand.config.jahr || '';

  const plan = await sola.vorschau(zustand.config);
  zustand.letzterPlan = plan;

  const bereit = Boolean(zustand.pfad) && plan.ordner.length > 1;
  $('btnErstellen').disabled = !bereit;
  $('planInfo').textContent = plan.ordner.length
    ? `${plan.ordner.length} Ordner · Sola_${plan.jahr}`
    : 'Noch nichts anzulegen';
  $('vorschauAnzahl').textContent = plan.ordner.length ? `(${plan.ordner.length} Ordner)` : '';
  $('vorschauBaum').textContent = baumText(plan.ordner);

  zeigeMeldungen('meldungen', plan.warnungen.map((text) => ({ art: 'warnung', text })));

  const jahr = String(plan.jahr || zustand.config.jahr || '');
  if (jahr.length === 4 && document.activeElement !== $('presetJahr')) $('presetJahr').value = jahr.slice(-2);
  pruefePresetKnopf();
}

/** Zeichnet die flache Pfadliste als eingerückten Baum. */
function baumText(ordner) {
  if (!ordner.length) return '';
  return ordner
    .map((pfad) => {
      const teile = pfad.split('/');
      return `${'    '.repeat(teile.length - 1)}${teile.length > 1 ? '└─ ' : ''}${teile[teile.length - 1]}`;
    })
    .join('\n');
}

function zeigeMeldungen(zielId, meldungen) {
  const ziel = $(zielId);
  ziel.textContent = '';
  for (const meldung of meldungen) {
    const div = document.createElement('div');
    div.className = `meldung meldung-${meldung.art}`;
    div.textContent = meldung.text;
    if (meldung.knopf) {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.textContent = meldung.knopf.text;
      knopf.addEventListener('click', meldung.knopf.aktion);
      div.appendChild(knopf);
    }
    ziel.appendChild(div);
  }
}

/** Leere Einträge zwischen Namen entfernen, damit die Nummerierung lückenlos bleibt. */
function rueckeNamenAuf(schluessel, rolle) {
  const gefuellt = zustand.config[schluessel][rolle].map((n) => String(n || '').trim()).filter(Boolean);
  while (gefuellt.length < ANZAHL_NAMEN) gefuellt.push('');
  zustand.config[schluessel][rolle] = gefuellt;
}

// Muss zur Prüfung in src/core/validate.js passen.
const NAME_MUSTER = /^[A-Za-zÀ-ÖØ-öø-ÿẞß]+(?:[ '.-][A-Za-zÀ-ÖØ-öø-ÿẞß]+)*$/;
const KUERZEL_MUSTER = /^(?:[A-Za-zÀ-ÖØ-öø-ÿ]{1,2}\.)+$/;
const nameOk = (wert) => NAME_MUSTER.test(String(wert).trim());

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

async function erstellen() {
  $('btnErstellen').disabled = true;
  let ergebnis;
  try {
    ergebnis = await sola.strukturErstellen(zustand.pfad, zustand.config);
  } catch (err) {
    await aktualisiere();
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Anlegen fehlgeschlagen: ${err.message}` }]);
    return;
  }

  // Erst auffrischen, dann melden – sonst überschreibt die Auffrischung
  // die Erfolgsmeldung sofort wieder.
  await aktualisiere();

  const meldungen = [
    ...ergebnis.warnungen.map((text) => ({ art: 'warnung', text })),
    ...ergebnis.fehler.map((f) => ({ art: 'fehler', text: `${f.pfad}: ${f.grund}` })),
  ];
  if (ergebnis.erstellt > 0 || ergebnis.vorhanden > 0) {
    meldungen.unshift({
      art: ergebnis.fehler.length ? 'warnung' : 'erfolg',
      text:
        `${ergebnis.erstellt} Ordner angelegt` +
        (ergebnis.vorhanden ? `, ${ergebnis.vorhanden} waren schon vorhanden` : '') +
        `. Wurzel: ${ergebnis.wurzel}`,
      knopf: { text: 'Im Finder/Explorer zeigen', aktion: () => sola.ordnerOeffnen(ergebnis.wurzel) },
    });
  }
  zeigeMeldungen('meldungen', meldungen);
}

async function speichern() {
  const ergebnis = await sola.configSpeichern(zustand.config);
  if (ergebnis.gespeichert) {
    zeigeMeldungen('meldungen', [{ art: 'erfolg', text: `Konfiguration gespeichert: ${ergebnis.pfad}` }]);
  } else if (ergebnis.fehler) {
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Speichern fehlgeschlagen: ${ergebnis.fehler}` }]);
  }
}

async function laden() {
  const ergebnis = await sola.configLaden();
  if (ergebnis.geladen) {
    zustand.config = ergebnis.config;
    await aktualisiere();
    zeigeMeldungen('meldungen', [{ art: 'erfolg', text: `Konfiguration geladen: ${ergebnis.pfad}` }]);
  } else if (ergebnis.fehler) {
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Laden fehlgeschlagen: ${ergebnis.fehler}` }]);
  }
}

// ---------------------------------------------------------------------------
// Lightroom-Vorgaben
// ---------------------------------------------------------------------------

function verdrahtePresets() {
  $('kuerzel').addEventListener('input', pruefePresetKnopf);
  $('presetJahr').addEventListener('input', pruefePresetKnopf);
  $('btnPresets').addEventListener('click', async () => {
    const daten = {
      jahr: $('presetJahr').value.trim(),
      sola: $('presetSola').value,
      kuerzel: $('kuerzel').value.trim(),
    };
    const ergebnis = await sola.presetsInstallieren(daten);
    const meldungen = ergebnis.fehler.map((f) => ({ art: 'fehler', text: `${f.datei}: ${f.grund}` }));
    if (ergebnis.installiert.length) {
      meldungen.unshift({
        art: ergebnis.erfolg ? 'erfolg' : 'warnung',
        text: `${ergebnis.installiert.length} Vorgaben installiert. Lightroom bitte neu starten.`,
        knopf: { text: 'Ordner zeigen', aktion: () => sola.ordnerOeffnen(ergebnis.ziele.exportPresets) },
      });
    }
    zeigeMeldungen('presetMeldungen', meldungen);
  });
}

function pruefePresetKnopf() {
  const kuerzel = $('kuerzel');
  const jahrOk = /^\d{2}$/.test($('presetJahr').value.trim());
  const kuerzelOk = KUERZEL_MUSTER.test(kuerzel.value.trim());
  kuerzel.classList.toggle('ungueltig', kuerzel.value.trim() !== '' && !kuerzelOk);
  $('btnPresets').disabled = !(jahrOk && kuerzelOk);
}

async function zeigeLightroomPfad() {
  const pfade = await sola.lightroomPfade();
  $('lrPfad').textContent = `Ziel: ${pfade.exportPresets} · ${pfade.developPresets}`;
}

init();
