// Settings: the saved summary mode, and a corrupt or unexpected file behaving like a missing one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from '../../../helpers.ts';

const fx = makeFixture();
const { getSummaryMode, setSummaryMode } = await import('../../../../src/server/features/settings/settings.ts');
const file = join(fx.dataDir, 'settings.json');

test('a missing file means the recap mode', () => {
  rmSync(file, { force: true });
  assert.equal(getSummaryMode(), 'recap');
});

test('a saved mode is read back, and an unknown mode is refused', () => {
  assert.equal(setSummaryMode('model'), true);
  assert.equal(getSummaryMode(), 'model');
  for (const mode of ['other', 5, null, undefined, {}, ['model']]) assert.equal(setSummaryMode(mode), false);
  assert.equal(getSummaryMode(), 'model');
});

test('a corrupt or unexpected file means the recap mode', () => {
  mkdirSync(fx.dataDir, { recursive: true });
  const unexpectedFiles = ['{"summary":', 'null', '[]', '"model"', '42', '{}', '{"summary":"other"}', '{"summary":["model"]}'];
  for (const content of unexpectedFiles) {
    writeFileSync(file, content);
    assert.equal(getSummaryMode(), 'recap', content);
  }
});
