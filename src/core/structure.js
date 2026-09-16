'use strict';

const { berechneWoche, solaJahr, SOLA_TAGE, normalisiereTage } = require('./dates');
const { sanitizeSegment, compactNames } = require('./validate');

/**
 * Die Solas, die sich anlegen lassen. Der Ordner steht fest und hängt *nicht*
 * an der Anwahl: Wer später ein weiteres Sola ergänzt, soll die schon
 * angelegten Ordner unverändert wiederfinden.
 */
const SOLAS = [
  { key: 'teens', label: 'Teens', titel: 'Teensola', ordner: '01_Teens' },
  { key: 'kids', label: 'Kids', titel: 'Kidssola', ordner: '02_Kids' },
  { key: 'sofa', label: 'SOFA', titel: 'SOFA', ordner: '03_SOFA' },
  { key: 'next', label: 'Sola next', titel: 'Sola next', ordner: '04_Sola_next' },
];

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

/**
 * Tagesordner heißen einheitlich `<n>_Tag_<dd-MM-yyyy>`.
 * Die Tagesnummer steht vorn, damit die Ordner nach Tag sortieren und im
 * Fotobereich vor `LR Kataloge` einsortiert werden.
 */
const tagOrdner = (tag, datum) => (datum ? `${tag}_Tag_${datum}` : `${tag}_Tag`);

/**
 * @typedef {Object} SolaAuswahl
 * @property {boolean} aktiv       Sola überhaupt angewählt
 * @property {string}  start       Startdatum als `yyyy-MM-dd`
 * @property {number}  tage        Dauer in Tagen (1–31)
 * @property {Object<string, boolean>} bereiche  Anwahl je Bereich (siehe BEREICHE)
 * @property {string[]} fotografen Bis zu 10 Namen
 * @property {string[]} videografen Bis zu 10 Namen
 */

/**
 * @typedef {Object} Config
 * @property {string} [jahr]  Solajahr; leer = automatisch aus den Startdaten
 * @property {SolaAuswahl} teens
 * @property {SolaAuswahl} kids
 * @property {SolaAuswahl} sofa
 * @property {SolaAuswahl} next
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

  const auto = solaJahr(SOLAS.filter((s) => cfg[s.key].aktiv).map((s) => ({ label: s.label, start: cfg[s.key].start })));
  const jahr = String(cfg.jahr || auto.jahr || '').trim();

  if (!jahr) {
    warnungen.push(
      auto.conflict
        ? `${auto.jahre.map((e) => `${e.label} (${e.jahr})`).join(', ')} liegen in verschiedenen Jahren – bitte das Solajahr manuell angeben.`
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

  for (const sola of SOLAS) {
    const auswahl = cfg[sola.key];
    if (!auswahl.aktiv) continue;
    const ordnerName = sola.ordner;

    const gewaehlt = BEREICHE.filter((b) => auswahl.bereiche[b.key]);
    if (gewaehlt.length === 0) {
      warnungen.push(`${sola.titel}: kein Bereich angewählt – es wird nur der Sola-Ordner angelegt.`);
    }

    const anzahlTage = auswahl.tage;
    const tage = berechneWoche(auswahl.start, anzahlTage);
    if (gewaehlt.length > 0 && tage.length === 0) {
      warnungen.push(`${sola.titel}: kein gültiges Startdatum – Tagesordner werden ohne Datum benannt.`);
    }
    const datumVon = (tag) => tage[tag - 1] || '';

    const basis = add(wurzel, ordnerName);

    gewaehlt.forEach((bereich, index) => {
      const bereichsPfad = add(basis, `${nr(index + 1)}_${bereich.label}`);

      switch (bereich.key) {
        case 'foto': {
          const fotografen = auswahl.fotografen.filter(Boolean);
          for (let tag = 1; tag <= anzahlTage; tag += 1) {
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
          for (let tag = 1; tag <= anzahlTage; tag += 1) {
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
          for (let tag = 1; tag <= anzahlTage; tag += 1) {
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

/**
 * Ermittelt für eine Person je Solatag den Zielordner, in den ihre Fotos bzw.
 * Videos importiert werden. Nutzt dieselben Bausteine wie {@link buildPlan} –
 * der Import landet damit garantiert in den Ordnern, die die App auch anlegt.
 *
 * Für Foto ist das der `01_ImportRAW`-Ordner der Person, für Video ihr Ordner
 * unter `01_Rohvideos`.
 *
 * @param {Config} config
 * @param {{solaKey: string, bereich: 'foto'|'video', person: string}} auswahl
 * @returns {{jahr: string, sola: string, person: string|null,
 *            ziele: Object<string, string>, warnungen: string[]}}
 *          `ziele` bildet `dd-MM-yyyy` auf den relativen Zielordner ab.
 */
function importZielordner(config, auswahl) {
  const cfg = normalizeConfig(config);
  const warnungen = [];
  const leer = { jahr: '', sola: '', person: null, ziele: {}, warnungen };

  const sola = SOLAS.find((s) => s.key === auswahl.solaKey);
  if (!sola) {
    warnungen.push('Unbekanntes Sola gewählt.');
    return leer;
  }
  leer.sola = sola.titel;
  const a = cfg[auswahl.solaKey];

  const auto = solaJahr(SOLAS.filter((s) => cfg[s.key].aktiv).map((s) => ({ label: s.label, start: cfg[s.key].start })));
  const jahr = String(cfg.jahr || auto.jahr || '').trim();
  if (!jahr) {
    warnungen.push('Kein Solajahr ermittelbar – bitte Startdatum wählen oder das Jahr manuell angeben.');
    return { ...leer, jahr: '' };
  }

  const bereich = BEREICHE.find((b) => b.key === auswahl.bereich);
  const gewaehlt = BEREICHE.filter((b) => a.bereiche[b.key]);
  const bereichIndex = gewaehlt.findIndex((b) => b.key === auswahl.bereich);
  if (!bereich || (auswahl.bereich !== 'foto' && auswahl.bereich !== 'video')) {
    warnungen.push('Import gibt es nur für die Bereiche Foto und Video.');
    return { ...leer, jahr };
  }
  if (bereichIndex === -1) {
    warnungen.push(`${sola.titel}: Bereich ${bereich.label} ist nicht angewählt – bitte oben aktivieren.`);
    return { ...leer, jahr };
  }
  const bereichName = `${nr(bereichIndex + 1)}_${bereich.label}`;

  const liste = (auswahl.bereich === 'foto' ? a.fotografen : a.videografen).filter(Boolean);
  const personIndex = liste.indexOf(String(auswahl.person || '').trim());
  if (personIndex === -1) {
    warnungen.push(`${sola.titel}: „${auswahl.person}" steht nicht in der ${bereich.label}-Namensliste.`);
    return { ...leer, jahr };
  }
  const personName = liste[personIndex];
  // Foto-Personen setzen die Nummerierung hinter den festen Tagesordnern fort,
  // Video-Personen zählen innerhalb von 01_Rohvideos ab 1.
  const personNr = auswahl.bereich === 'foto' ? personIndex + 1 + FOTO_TAG_ORDNER(1).length : personIndex + 1;
  const personOrdner = `${nr(personNr)}_${personName}`;

  const tage = berechneWoche(a.start, a.tage);
  if (tage.length === 0) {
    warnungen.push(`${sola.titel}: kein gültiges Startdatum – Tage lassen sich nicht bestimmen.`);
    return { ...leer, jahr, person: personName };
  }

  const wurzel = sanitizeSegment(`Sola_${jahr}`);
  const seg = (...segmente) => [wurzel, ...segmente.map(sanitizeSegment)].filter(Boolean).join('/');

  const ziele = {};
  tage.forEach((datum, i) => {
    const tagName = tagOrdner(i + 1, datum);
    ziele[datum] = auswahl.bereich === 'foto'
      ? seg(sola.ordner, bereichName, tagName, personOrdner, FOTO_UNTERORDNER[0])
      : seg(sola.ordner, bereichName, tagName, VIDEO_TAG_ORDNER[0], personOrdner);
  });

  return { jahr, sola: sola.titel, person: personName, ziele, warnungen };
}

/** Füllt fehlende Felder auf und normalisiert die Namenslisten. */
function normalizeConfig(config) {
  const quelle = config || {};
  const sola = (raw) => {
    const src = raw || {};
    const bereiche = {};
    for (const b of BEREICHE) bereiche[b.key] = Boolean((src.bereiche || {})[b.key]);
    return {
      aktiv: Boolean(src.aktiv),
      start: String(src.start || ''),
      tage: normalisiereTage(src.tage),
      bereiche,
      fotografen: compactNames(src.fotografen),
      videografen: compactNames(src.videografen),
    };
  };
  const ergebnis = { jahr: String(quelle.jahr || '') };
  for (const s of SOLAS) ergebnis[s.key] = sola(quelle[s.key]);
  return ergebnis;
}

/** Leere Konfiguration – Ausgangspunkt für die Oberfläche und für Tests. */
function emptyConfig() {
  const sola = () => ({
    aktiv: false,
    start: '',
    tage: SOLA_TAGE,
    bereiche: Object.fromEntries(BEREICHE.map((b) => [b.key, false])),
    fotografen: Array(10).fill(''),
    videografen: Array(10).fill(''),
  });
  const ergebnis = { jahr: '' };
  for (const s of SOLAS) ergebnis[s.key] = sola();
  return ergebnis;
}

module.exports = {
  SOLAS,
  BEREICHE,
  FOTO_UNTERORDNER,
  FOTO_TAG_ORDNER,
  VIDEO_TAG_ORDNER,
  LR_KATALOGE,
  buildPlan,
  importZielordner,
  normalizeConfig,
  emptyConfig,
};
