import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecord } from '../../src/shared/guards.ts';

test('isRecord accepts plain objects', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ id: 'a', nested: { x: 1 } }), true);
});

test('isRecord rejects null, arrays and primitives', () => {
  for (const value of [null, undefined, [], [{}], 'text', 0, 42, true, () => ({})]) {
    assert.equal(isRecord(value), false);
  }
});
