import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPairCodeValid, isPairSuccess, pairFailureText } from '../../../../src/client/features/pair/pair.logic.ts';

test('only the state "ok" is a valid code', () => {
  assert.equal(isPairCodeValid('ok'), true);
  assert.equal(isPairCodeValid('bad'), false);
  assert.equal(isPairCodeValid(undefined), false);
});

test('isPairSuccess accepts only { ok: true }', () => {
  assert.equal(isPairSuccess({ ok: true }), true);
  assert.equal(isPairSuccess({ ok: 'true' }), false);
  assert.equal(isPairSuccess(null), false);
  assert.equal(isPairSuccess([true]), false);
});

test('pairFailureText tells rate limiting from an invalid code', () => {
  assert.match(pairFailureText(429), /Too many attempts/);
  assert.match(pairFailureText(401), /already used or has expired/);
});
