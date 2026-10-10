import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, parseSkin } from '../../../src/client/skins/skin.ts';

test('SKINS lists classic, copilot and root', () => {
  assert.deepEqual([...SKINS], ['classic', 'copilot', 'root']);
});

test('parseSkin accepts known skins', () => {
  assert.equal(parseSkin('classic'), 'classic');
  assert.equal(parseSkin('copilot'), 'copilot');
  assert.equal(parseSkin('root'), 'root');
});

test('parseSkin falls back to classic for unknown or missing values (case-sensitive)', () => {
  for (const v of [null, undefined, '', 'Copilot', 'COPILOT', ' copilot', 'Root', 'ROOT', ' root', 'root ', 'nope']) {
    assert.equal(parseSkin(v), 'classic', String(v));
  }
});
