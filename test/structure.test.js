'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPlan, emptyConfig, BEREICHE } = require('../src/core/structure');

/** Baut eine Konfiguration mit den angegebenen Abweichungen vom Leerzustand. */
function config({ sola = 'teens', start = '2026-06-13', bereiche = [], fotografen = [], videografen = [] } = {}) {
  const c = emptyConfig();
  c[sola].aktiv = true;
  c[sola].start = start;
  for (const b of bereiche) c[sola].bereiche[b] = true;
  fotografen.forEach((n, i) => {
    c[sola].fotografen[i] = n;
  });
  videografen.forEach((n, i) => {
    c[sola].videografen[i] = n;
  });
  return c;
}

test('ohne Anwahl entsteht kein Ordner', () => {
  const { ordner, warnungen } = buildPlan(emptyConfig());
  assert.deepEqual(ordner, []);
  assert.equal(warnungen.length, 1);
});

test('Solajahr kommt aus dem Startdatum', () => {
  const { jahr, ordner } = buildPlan(config({ bereiche: ['orga'] }));
  assert.equal(jahr, '2026');
  assert.ok(ordner.includes('Sola_2026'));
  assert.ok(ordner.includes('Sola_2026/01_Teens'));
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Orga'));
});

test('verschiedene Jahre erzwingen eine manuelle Eingabe', () => {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.orga = true;
  c.kids.aktiv = true;
  c.kids.start = '2027-07-01';
  c.kids.bereiche.orga = true;

  const ohneJahr = buildPlan(c);
  assert.deepEqual(ohneJahr.ordner, []);
  assert.match(ohneJahr.warnungen[0], /verschiedenen Jahren/);

  c.jahr = '2026';
  const mitJahr = buildPlan(c);
  assert.equal(mitJahr.jahr, '2026');
  assert.ok(mitJahr.ordner.includes('Sola_2026/02_Kids/01_Orga'));
});

test('Bereiche werden in fester Reihenfolge lückenlos nummeriert', () => {
  const { ordner } = buildPlan(config({ bereiche: ['video', 'orga'], videografen: [] }));
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Video'));
  assert.ok(ordner.includes('Sola_2026/01_Teens/02_Orga'));
  assert.ok(!ordner.some((p) => /_Foto$/.test(p)));
});

test('Fotobereich legt acht Tage mit festen Unterordnern an', () => {
  const { ordner } = buildPlan(config({ bereiche: ['foto'] }));
  const basis = 'Sola_2026/01_Teens/01_Foto';

  assert.ok(ordner.includes(`${basis}/1_Tag_13-06-2026`));
  assert.ok(ordner.includes(`${basis}/8_Tag_20-06-2026`));
  assert.ok(!ordner.includes(`${basis}/9_Tag_21-06-2026`));

  const tag1 = `${basis}/1_Tag_13-06-2026`;
  assert.ok(ordner.includes(`${tag1}/01_Bilder_des_Tages_1_HQ`));
  assert.ok(ordner.includes(`${tag1}/02_Bilder_des_Tages_1_LQ`));
  assert.ok(ordner.includes(`${tag1}/03_Auswahl Bilderclip`));
  assert.ok(ordner.includes(`${tag1}/04_Auswahl Musik`));
  assert.ok(ordner.includes(`${basis}/LR Kataloge`));
});

test('Tagesordner sortieren nach Tag und stehen vor "LR Kataloge"', () => {
  const { ordner } = buildPlan(config({ bereiche: ['foto'] }));
  const basis = 'Sola_2026/01_Teens/01_Foto';
  const kinder = ordner
    .filter((p) => p.startsWith(`${basis}/`) && p.split('/').length === 4)
    .map((p) => p.split('/')[3]);

  // So, wie Finder und Explorer die Einträge anzeigen.
  const sortiert = [...kinder].sort((a, b) => a.localeCompare(b, 'de'));
  assert.deepEqual(sortiert, [
    '1_Tag_13-06-2026',
    '2_Tag_14-06-2026',
    '3_Tag_15-06-2026',
    '4_Tag_16-06-2026',
    '5_Tag_17-06-2026',
    '6_Tag_18-06-2026',
    '7_Tag_19-06-2026',
    '8_Tag_20-06-2026',
    'LR Kataloge',
  ]);
});

test('Personenordner setzen die Nummerierung fort und bekommen Unterordner', () => {
  const { ordner } = buildPlan(config({ bereiche: ['foto'], fotografen: ['Lars', 'Maja'] }));
  const tag1 = 'Sola_2026/01_Teens/01_Foto/1_Tag_13-06-2026';

  assert.ok(ordner.includes(`${tag1}/05_Lars`));
  assert.ok(ordner.includes(`${tag1}/06_Maja`));
  for (const unter of ['01_ImportRAW', '02_ExportJPEG_HQ', '03_ExportJPEG_LQ', '04_ExportRAW']) {
    assert.ok(ordner.includes(`${tag1}/05_Lars/${unter}`), unter);
  }
  // In "LR Kataloge" wird bei 01 neu gezählt.
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Foto/LR Kataloge/01_Lars'));
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Foto/LR Kataloge/02_Maja'));
});

test('Videograf:innen landen unter 01_Rohvideos', () => {
  const { ordner } = buildPlan(config({ bereiche: ['video'], videografen: ['Jonas'] }));
  const tag3 = 'Sola_2026/01_Teens/01_Video/3_Tag_15-06-2026';
  assert.ok(ordner.includes(`${tag3}/01_Rohvideos`));
  assert.ok(ordner.includes(`${tag3}/02_Projektdatein`));
  assert.ok(ordner.includes(`${tag3}/03_Audio-Musik`));
  assert.ok(ordner.includes(`${tag3}/01_Rohvideos/01_Jonas`));
});

test('Showfiles und Audio bekommen nur Tagesordner', () => {
  const { ordner } = buildPlan(config({ bereiche: ['showfiles', 'audio'] }));
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Showfiles/1_Tag_13-06-2026'));
  assert.ok(ordner.includes('Sola_2026/01_Teens/02_Audio/8_Tag_20-06-2026'));
  assert.equal(ordner.filter((p) => p.startsWith('Sola_2026/01_Teens/01_Showfiles/')).length, 8);
});

test('Instagram, Grafik, Orga und Allgemein bleiben einstufig', () => {
  const { ordner } = buildPlan(config({ bereiche: ['instagram', 'grafik', 'orga', 'allgemein'] }));
  for (const name of ['01_Instagram', '02_Grafik', '03_Orga', '04_Allgemein']) {
    const pfad = `Sola_2026/01_Teens/${name}`;
    assert.ok(ordner.includes(pfad), pfad);
    assert.equal(ordner.filter((p) => p.startsWith(`${pfad}/`)).length, 0);
  }
});

test('Teens und Kids können unterschiedliche Startdaten haben', () => {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.showfiles = true;
  c.kids.aktiv = true;
  c.kids.start = '2026-08-01';
  c.kids.bereiche.showfiles = true;

  const { ordner } = buildPlan(c);
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Showfiles/1_Tag_13-06-2026'));
  assert.ok(ordner.includes('Sola_2026/02_Kids/01_Showfiles/1_Tag_01-08-2026'));
});

test('Namenslücken werden geschlossen', () => {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.fotografen = ['', 'Maja', '', 'Lars', '', '', '', '', '', ''];

  const { ordner } = buildPlan(c);
  const tag1 = 'Sola_2026/01_Teens/01_Foto/1_Tag_13-06-2026';
  assert.ok(ordner.includes(`${tag1}/05_Maja`));
  assert.ok(ordner.includes(`${tag1}/06_Lars`));
  assert.ok(!ordner.some((p) => /\/07_/.test(p)));
});

test('Namen mit Pfadtrennern oder Doppelpunkt werden entschärft', () => {
  const { ordner } = buildPlan(config({ bereiche: ['foto'], fotografen: ['A/B:C'] }));
  assert.ok(ordner.includes('Sola_2026/01_Teens/01_Foto/1_Tag_13-06-2026/05_A_B_C'));
  // Kein Segment darf einen Backslash oder Doppelpunkt enthalten.
  for (const pfad of ordner) {
    for (const segment of pfad.split('/')) {
      assert.doesNotMatch(segment, /[\\:]/, pfad);
    }
  }
});

test('Jeder Bereichsschlüssel führt zu einem Ordner', () => {
  for (const bereich of BEREICHE) {
    const { ordner } = buildPlan(config({ bereiche: [bereich.key] }));
    assert.ok(ordner.includes(`Sola_2026/01_Teens/01_${bereich.label}`), bereich.key);
  }
});

test('der Plan ist frei von Dubletten und sortiert', () => {
  const { ordner } = buildPlan(
    config({ bereiche: BEREICHE.map((b) => b.key), fotografen: ['Lars'], videografen: ['Maja'] }),
  );
  assert.equal(new Set(ordner).size, ordner.length);
  assert.deepEqual(ordner, [...ordner].sort());
});
