import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, parseSkin } from '../src/client/skin.ts';

test('SKINS lists classic and copilot', () => {
  assert.deepEqual([...SKINS], ['classic', 'copilot']);
});

test('parseSkin accepts known skins', () => {
  assert.equal(parseSkin('classic'), 'classic');
  assert.equal(parseSkin('copilot'), 'copilot');
});

test('parseSkin falls back to classic for unknown or missing values (case-sensitive)', () => {
  for (const v of [null, undefined, '', 'Copilot', 'COPILOT', ' copilot', 'nope']) {
    assert.equal(parseSkin(v), 'classic', String(v));
  }
});
