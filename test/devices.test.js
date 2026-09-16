'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listRemovable, hatDcim } = require('../src/core/devices');

test('hatDcim erkennt einen DCIM-Ordner (auch klein geschrieben)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(hatDcim(dir), false);
  fs.mkdirSync(path.join(dir, 'dcim'));
  assert.equal(hatDcim(dir), true);
  assert.equal(hatDcim(path.join(dir, 'gibtsnicht')), false);
});

test('listRemovable liefert ohne Fehler eine Liste passender Form', () => {
  const liste = listRemovable();
  assert.ok(Array.isArray(liste));
  for (const g of liste) {
    assert.equal(typeof g.pfad, 'string');
    assert.equal(typeof g.name, 'string');
    assert.equal(typeof g.kamera, 'boolean');
  }
});
