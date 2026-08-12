'use strict';

const { berechneWoche, solaJahr, SOLA_TAGE } = require('./dates');
const { sanitizeSegment, compactNames } = require('./validate');

/**
 * Die acht Bereiche in der Reihenfolge, in der sie durchnummeriert werden.
 * Nur angewählte Bereiche verbrauchen eine Nummer – sind z.B. nur Video und
 * Orga gewählt, entstehen `01_Video` und `02_Orga`.
 */
const BEREICHE = [
  { key: 'foto', label: 'Foto' },
  { key: 'video', label: 'Video' },
  { key: 'showfiles', label: 'Showfiles' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'grafik', label: 'Grafik' },
  { key: 'audio', label: 'Audio' },
  { key: 'orga', label: 'Orga' },
  { key: 'allgemein', label: 'Allgemein' },
];

/** Unterordner, die jede Fotografin / jeder Fotograf pro Tag bekommt. */
const FOTO_UNTERORDNER = ['01_ImportRAW', '02_ExportJPEG_HQ', '03_ExportJPEG_LQ', '04_ExportRAW'];

/** Feste Ordner, die in jedem Tagesordner unterhalb von `NN_Foto` liegen. */
const FOTO_TAG_ORDNER = (tag) => [
  `01_Bilder_des_Tages_${tag}_HQ`,
  `02_Bilder_des_Tages_${tag}_LQ`,
  '03_Auswahl Bilderclip',
  '04_Auswahl Musik',
];

/** Feste Ordner, die in jedem Tagesordner unterhalb von `NN_Video` liegen. */
const VIDEO_TAG_ORDNER = ['01_Rohvideos', '02_Projektdatein', '03_Audio-Musik'];

const LR_KATALOGE = 'LR Kataloge';

/** `1` -> `01`, `12` -> `12` */
const nr = (n) => String(n).padStart(2, '0');

/** Tagesordner heißen einheitlich `Tag_<n>_<dd-MM-yyyy>`. */
const tagOrdner = (tag, datum) => (datum ? `Tag_${tag}_${datum}` : `Tag_${tag}`);

/**
 * @typedef {Object} SolaAuswahl
 * @property {boolean} aktiv       Sola überhaupt angewählt
 * @property {string}  start       Startdatum als `yyyy-MM-dd`
 * @property {Object<string, boolean>} bereiche  Anwahl je Bereich (siehe BEREICHE)
 * @property {string[]} fotografen Bis zu 10 Namen
 * @property {string[]} videografen Bis zu 10 Namen
 */

/**
 * @typedef {Object} Config
 * @property {string} [jahr]  Solajahr; leer = automatisch aus den Startdaten
 * @property {SolaAuswahl} teens
 * @property {SolaAuswahl} kids
 */

/**
 * Baut den Ordnerbaum als flache, sortierte Liste relativer Pfade.
 * Rein funktional – schreibt nichts auf die Platte, damit die Vorschau in der
 * Oberfläche und der tatsächliche Anlagevorgang garantiert übereinstimmen.
 *
 * Die Segmente werden mit `/` verbunden; erst beim Anlegen wird auf den
 * Plattform-Trenner umgestellt.
 *
 * @param {Config} config
 * @returns {{ordner: string[], jahr: string, warnungen: string[]}}
 */
function buildPlan(config) {
  const warnungen = [];
  const cfg = normalizeConfig(config);

  const auto = solaJahr({
    teens: cfg.teens.aktiv,
    kids: cfg.kids.aktiv,
    teenStart: cfg.teens.start,
    kidsStart: cfg.kids.start,
  });
  const jahr = String(cfg.jahr || auto.jahr || '').trim();

  if (!jahr) {
    warnungen.push(
      auto.conflict
        ? `Teens (${auto.teenJahr}) und Kids (${auto.kidsJahr}) liegen in verschiedenen Jahren – bitte das Solajahr manuell angeben.`
        : 'Kein Solajahr ermittelbar – bitte Startdatum wählen oder das Jahr manuell angeben.',
    );
    return { ordner: [], jahr: '', warnungen };
  }

  const wurzel = sanitizeSegment(`Sola_${jahr}`);
  /** @type {Set<string>} */
  const ordner = new Set([wurzel]);

  /**
   * Hängt `segmente` an den bereits bereinigten Pfad `elternPfad` an, merkt sich
   * das Ergebnis und gibt es zurück – so wird jedes Segment genau einmal
   * bereinigt und Kindpfade bauen immer auf dem bereinigten Elternpfad auf.
   */
  const add = (elternPfad, ...segmente) => {
    const pfad = [elternPfad, ...segmente.map(sanitizeSegment)].filter(Boolean).join('/');
    ordner.add(pfad);
    return pfad;
  };

  const solas = [
    { auswahl: cfg.teens, ordnerName: '01_Teens' },
    { auswahl: cfg.kids, ordnerName: '02_Kids' },
  ];

  for (const { auswahl, ordnerName } of solas) {
    if (!auswahl.aktiv) continue;

    const gewaehlt = BEREICHE.filter((b) => auswahl.bereiche[b.key]);
    if (gewaehlt.length === 0) {
      warnungen.push(`${ordnerName}: kein Bereich angewählt – es wird nur der Sola-Ordner angelegt.`);
    }

    const tage = berechneWoche(auswahl.start);
    if (gewaehlt.length > 0 && tage.length === 0) {
      warnungen.push(`${ordnerName}: kein gültiges Startdatum – Tagesordner werden ohne Datum benannt.`);
    }
    const datumVon = (tag) => tage[tag - 1] || '';

    const basis = add(wurzel, ordnerName);

    gewaehlt.forEach((bereich, index) => {
      const bereichsPfad = add(basis, `${nr(index + 1)}_${bereich.label}`);

      switch (bereich.key) {
        case 'foto': {
          const fotografen = auswahl.fotografen.filter(Boolean);
          for (let tag = 1; tag <= SOLA_TAGE; tag += 1) {
            const tagPfad = add(bereichsPfad, tagOrdner(tag, datumVon(tag)));
            const feste = FOTO_TAG_ORDNER(tag);
            for (const name of feste) add(tagPfad, name);
            // Die Personenordner setzen die Nummerierung der festen Ordner fort.
            fotografen.forEach((name, i) => {
              const personPfad = add(tagPfad, `${nr(i + 1 + feste.length)}_${name}`);
              for (const unter of FOTO_UNTERORDNER) add(personPfad, unter);
            });
          }
          // Lightroom-Kataloge liegen einmalig neben den Tagesordnern.
          const katalogPfad = add(bereichsPfad, LR_KATALOGE);
          fotografen.forEach((name, i) => add(katalogPfad, `${nr(i + 1)}_${name}`));
          break;
        }

        case 'video': {
          const videografen = auswahl.videografen.filter(Boolean);
          for (let tag = 1; tag <= SOLA_TAGE; tag += 1) {
            const tagPfad = add(bereichsPfad, tagOrdner(tag, datumVon(tag)));
            let rohvideos = '';
            for (const name of VIDEO_TAG_ORDNER) {
              const pfad = add(tagPfad, name);
              if (name === VIDEO_TAG_ORDNER[0]) rohvideos = pfad;
            }
            // Jede Videografin / jeder Videograf bekommt einen Ordner in 01_Rohvideos.
            videografen.forEach((name, i) => add(rohvideos, `${nr(i + 1)}_${name}`));
          }
          break;
        }

        case 'showfiles':
        case 'audio': {
          for (let tag = 1; tag <= SOLA_TAGE; tag += 1) {
            add(bereichsPfad, tagOrdner(tag, datumVon(tag)));
          }
          break;
        }

        default:
          // Instagram, Grafik, Orga und Allgemein bleiben einstufig.
          break;
      }
    });
  }

  return { ordner: [...ordner].sort(), jahr, warnungen };
}

/** Füllt fehlende Felder auf und normalisiert die Namenslisten. */
function normalizeConfig(config) {
  const sola = (raw) => {
    const src = raw || {};
    const bereiche = {};
    for (const b of BEREICHE) bereiche[b.key] = Boolean((src.bereiche || {})[b.key]);
    return {
      aktiv: Boolean(src.aktiv),
      start: String(src.start || ''),
      bereiche,
      fotografen: compactNames(src.fotografen),
      videografen: compactNames(src.videografen),
    };
  };
  return {
    jahr: String((config || {}).jahr || ''),
    teens: sola((config || {}).teens),
    kids: sola((config || {}).kids),
  };
}

/** Leere Konfiguration – Ausgangspunkt für die Oberfläche und für Tests. */
function emptyConfig() {
  const sola = () => ({
    aktiv: false,
    start: '',
    bereiche: Object.fromEntries(BEREICHE.map((b) => [b.key, false])),
    fotografen: Array(10).fill(''),
    videografen: Array(10).fill(''),
  });
  return { jahr: '', teens: sola(), kids: sola() };
}

module.exports = {
  BEREICHE,
  FOTO_UNTERORDNER,
  FOTO_TAG_ORDNER,
  VIDEO_TAG_ORDNER,
  LR_KATALOGE,
  buildPlan,
  normalizeConfig,
  emptyConfig,
};
